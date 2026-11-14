package com.kyro.classdesk.ui

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.kyro.classdesk.data.ClassDeskApi
import com.kyro.classdesk.data.DocumentDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.launch

@Composable
fun DocumentLibraryScreen(api: ClassDeskApi, isPrimaryAdmin: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var documents by remember { mutableStateOf<List<DocumentDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val result = api.documents()
            if (result.isSuccessful) documents = result.body()?.documents.orEmpty()
            else error = "Could not load documents (\${result.code()})."
        } catch (_: Exception) { error = "Document service is unavailable. Check your connection." }
        finally { loading = false }
    }

    LaunchedEffect(Unit) { reload() }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            uploading = true
            error = null
            try {
                val filename = context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (cursor.moveToFirst() && index >= 0) cursor.getString(index) else null
                } ?: "class-material"
                val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Could not read the selected file.")
                require(bytes.isNotEmpty() && bytes.size <= 20 * 1024 * 1024) { "Choose a non-empty file under 20 MB." }
                val filePart = MultipartBody.Part.createFormData("file", filename, bytes.toRequestBody(mime.toMediaType()))
                val fields = mapOf("title" to filename.toRequestBody("text/plain".toMediaType()))
                val result = api.uploadDocument(filePart, fields)
                if (result.isSuccessful) reload()
                else error = "Upload failed (\${result.code()}). Check the file type and server storage."
            } catch (e: Exception) {
                error = e.message ?: "Upload failed."
            } finally { uploading = false }
        }
    }

    Column(
        Modifier.fillMaxWidth().background(Color(0xFF0A1019)).padding(18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("LECTURE MATERIALS / DOCUMENT LIBRARY", color = Color(0xFFF2C94C), fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.Bold)
        Button(onClick = { picker.launch(arrayOf("*/*")) }, enabled = !uploading, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019)), shape = RoundedCornerShape(6.dp)) {
            Text(if (uploading) "UPLOADING / INDEXING…" else "＋ UPLOAD DOCUMENT", fontWeight = FontWeight.Bold)
        }
        Text("PDF, DOCX, PPTX, TXT, Markdown and supported images. Files are scanned and indexed by the ClassDesk server.", color = Color(0xFF91A4B8), fontSize = 11.sp)
        if (loading) CircularProgressIndicator(color = Color(0xFF42D9F5))
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        if (!loading && documents.isEmpty()) Text("No lecture materials uploaded yet.", color = Color(0xFF91A4B8))
        documents.forEach { document ->
            Surface(color = Color(0xFF111B28), shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(document.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text(document.filename, color = Color(0xFF91A4B8), fontSize = 11.sp)
                    Text("\${document.status} / \${document.securityScanStatus} / \${(document.sizeBytes / 1024).coerceAtLeast(1)} KB", color = Color(0xFF42D9F5), fontSize = 10.sp)
                    listOfNotNull(document.courseCode, document.topic).takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" / "), color = Color(0xFF91A4B8), fontSize = 11.sp) }
                    if (isPrimaryAdmin) TextButton(onClick = {
                        scope.launch {
                            val result = api.deleteDocument(document.id)
                            if (result.isSuccessful) documents = api.documents().body()?.documents.orEmpty()
                            else error = "Document deletion failed (\${result.code()})."
                        }
                    }) { Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                }
            }
        }
    }
}
