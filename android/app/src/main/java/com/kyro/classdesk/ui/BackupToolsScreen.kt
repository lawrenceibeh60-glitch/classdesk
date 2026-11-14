package com.kyro.classdesk.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyro.classdesk.data.ClassDeskApi
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

private const val RestorePhrase = "RESTORE_CLASSDESK_BACKUP"

@Composable
fun BackupToolsScreen(api: ClassDeskApi, isPrimaryAdmin: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var exportType by remember { mutableStateOf("json") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var restoreBytes by remember { mutableStateOf<ByteArray?>(null) }
    var restoreMime by remember { mutableStateOf("application/json") }
    var confirmation by remember { mutableStateOf("") }
    var showConfirmation by remember { mutableStateOf(false) }

    val saveBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true; error = null; message = null
            try {
                val response = if (exportType == "zip") api.exportZipBackup() else api.exportJsonBackup()
                if (!response.isSuccessful) throw IllegalStateException("Backup export failed (${response.code()}).")
                val bytes = response.body()?.bytes() ?: throw IllegalStateException("The server returned an empty backup.")
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("Could not save the backup to the selected location.")
                message = "Backup exported successfully (${bytes.size / 1024} KB). Store it somewhere private and secure."
            } catch (e: Exception) { error = e.message ?: "Backup export failed." }
            finally { busy = false }
        }
    }

    val chooseRestore = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Could not read the selected backup.")
                require(bytes.isNotEmpty() && bytes.size <= 100 * 1024 * 1024) { "Choose a non-empty backup no larger than 100 MB." }
                restoreMime = context.contentResolver.getType(uri) ?: "application/json"
                restoreBytes = bytes
                confirmation = ""
                showConfirmation = true
            } catch (e: Exception) { error = e.message ?: "Could not read backup." }
        }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFF0A1019)).verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("DATA SAFETY / BACKUP & EXPORT", color = Color(0xFFF2C94C), fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.Bold)
        Text("Exports use the same protected server endpoints as the website. JSON contains academic data and searchable document text; ZIP can also include original uploaded files available in object storage.", color = Color(0xFF91A4B8), fontSize = 12.sp)
        if (!isPrimaryAdmin) {
            Text("Backup and restore are available only to the primary ClassDesk account.", color = Color(0xFFFF7D78), fontSize = 13.sp)
        } else {
            Button(onClick = { exportType = "json"; saveBackup.launch("afit-classdesk-backup.json") }, enabled = !busy, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019)), shape = RoundedCornerShape(6.dp)) {
                Text(if (busy) "WORKING…" else "EXPORT JSON BACKUP", fontWeight = FontWeight.Bold)
            }
            OutlinedButton(onClick = { exportType = "zip"; saveBackup.launch("afit-classdesk-complete-backup.zip") }, enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
                Text("EXPORT COMPLETE ZIP", color = Color(0xFF42D9F5), fontWeight = FontWeight.Bold)
            }
            HorizontalDivider(color = Color(0xFF26384B))
            Text("RESTORE FROM BACKUP", color = Color.White, fontWeight = FontWeight.Bold)
            Text("Restore merges matching IDs and does not delete unrelated live records. It changes shared ClassDesk data for both website and Android users.", color = Color(0xFF91A4B8), fontSize = 11.sp)
            OutlinedButton(onClick = { chooseRestore.launch(arrayOf("application/json", "application/zip", "application/x-zip-compressed")) }, enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
                Text("SELECT BACKUP FILE", color = Color(0xFFF2C94C))
            }
        }
        if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFF42D9F5))
        message?.let { Text(it, color = Color(0xFF42D9F5), fontSize = 12.sp) }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        Text("SECURITY NOTE / Backups can contain private class records and uploaded academic material. Keep exported files private.", color = Color(0xFF91A4B8), fontSize = 10.sp)
    }

    if (showConfirmation) AlertDialog(
        onDismissRequest = { showConfirmation = false; restoreBytes = null },
        title = { Text("Confirm shared-data restore") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("This will merge backup content into the live ClassDesk database. This action affects both platforms.")
                OutlinedTextField(confirmation, { confirmation = it }, label = { Text("Type ${RestorePhrase}") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val bytes = restoreBytes ?: return@TextButton
                scope.launch {
                    busy = true; error = null; message = null; showConfirmation = false
                    try {
                        val mime = if (restoreMime.contains("zip")) "application/zip" else "application/json"
                        val body = bytes.toRequestBody(mime.toMediaType())
                        val response = api.restoreBackup(mime, RestorePhrase, body)
                        if (!response.isSuccessful) throw IllegalStateException(response.errorBody()?.string()?.take(400) ?: "Restore failed (${response.code()}).")
                        message = "Restore completed. Reopen the relevant modules to refresh shared data."
                    } catch (e: Exception) { error = e.message ?: "Restore failed." }
                    finally { busy = false; restoreBytes = null; confirmation = "" }
                }
            }, enabled = confirmation == RestorePhrase && restoreBytes != null) { Text("RESTORE DATA") }
        },
        dismissButton = { TextButton(onClick = { showConfirmation = false; restoreBytes = null }) { Text("CANCEL") } }
    )
}
