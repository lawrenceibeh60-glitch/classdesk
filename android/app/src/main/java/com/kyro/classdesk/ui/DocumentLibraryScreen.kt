package com.kyro.classdesk.ui

import android.provider.OpenableColumns
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.net.Uri
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
    var downloadId by remember { mutableStateOf<String?>(null) }
    var downloadName by remember { mutableStateOf("class-material") }
    var courseCode by remember { mutableStateOf("") }
    var courseName by remember { mutableStateOf("") }
    var topic by remember { mutableStateOf("") }
    var lectureDate by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<DocumentDto?>(null) }

    suspend fun reload() {
        loading = true
        try {
            val result = api.documents()
            if (result.isSuccessful) documents = result.body()?.documents.orEmpty()
            else error = "Could not load documents (\${result.code()})."
        } catch (_: Exception) { error = "Document service is unavailable. Check your connection." }
        finally { loading = false }
    }

    val saveDownload = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val id = downloadId
        if (uri != null && id != null) scope.launch {
            try {
                val result = api.downloadDocument(id)
                if (!result.isSuccessful) throw IllegalStateException("Download failed (${result.code()}).")
                val bytes = result.body()?.bytes() ?: throw IllegalStateException("The server returned an empty file.")
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("Could not save the downloaded file.")
                error = null
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, context.contentResolver.getType(uri) ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
            } catch (e: Exception) { error = e.message ?: "Download failed." }
            finally { downloadId = null }
        }
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
                val fields = mapOf(
                    "title" to filename.toRequestBody("text/plain".toMediaType()),
                    "courseCode" to courseCode.trim().toRequestBody("text/plain".toMediaType()),
                    "courseName" to courseName.trim().toRequestBody("text/plain".toMediaType()),
                    "topic" to topic.trim().toRequestBody("text/plain".toMediaType()),
                    "lectureDate" to lectureDate.trim().toRequestBody("text/plain".toMediaType())
                )
                val result = api.uploadDocument(filePart, fields)
                if (result.isSuccessful) reload()
                else error = "Upload failed (\${result.code()}). Check the file type and server storage."
            } catch (e: Exception) {
                error = e.message ?: "Upload failed."
            } finally { uploading = false }
        }
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Permanently delete document?") },
            text = { Text("This will remove ${target.title} from ClassDesk's database and shared object storage. This action cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        val result = api.deleteDocument(target.id)
                        if (result.isSuccessful) {
                            documents = documents.filterNot { it.id == target.id }
                            error = null
                        } else error = "Document deletion failed (HTTP ${result.code()})."
                        deleteTarget = null
                    }
                }) { Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78)) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("CANCEL") } }
        )
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
        OutlinedTextField(courseCode, { courseCode = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Course code (optional)") }, singleLine = true)
        OutlinedTextField(courseName, { courseName = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Course name (optional)") }, singleLine = true)
        OutlinedTextField(topic, { topic = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Topic (optional)") }, singleLine = true)
        OutlinedTextField(lectureDate, { lectureDate = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Lecture date (optional)") }, singleLine = true)
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
                    TextButton(onClick = { downloadId = document.id; downloadName = document.filename; saveDownload.launch(document.filename) }) { Text("DOWNLOAD / OPEN", color = Color(0xFF42D9F5), fontSize = 10.sp) }
                    if (isPrimaryAdmin) TextButton(onClick = { deleteTarget = document }) {
                        Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78), fontSize = 10.sp)
                    }
                }
            }
        }
    }
}
