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
import com.kyro.classdesk.data.AvaTaskDto
import com.kyro.classdesk.data.AvaTaskCreateRequest
import com.kyro.classdesk.data.ClassDeskApi
import com.kyro.classdesk.data.DocumentDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

private val AvaCanvas = Color(0xFF0A1019)
private val AvaPanel = Color(0xFF111B28)
private val AvaCyan = Color(0xFF42D9F5)
private val AvaGold = Color(0xFFF2C94C)
private val AvaMuted = Color(0xFF91A4B8)

@Composable
fun AvaTasksScreen(api: ClassDeskApi) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var documents by remember { mutableStateOf<List<DocumentDto>>(emptyList()) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var tasks by remember { mutableStateOf<List<AvaTaskDto>>(emptyList()) }
    var prompt by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var workerOnline by remember { mutableStateOf(false) }
    var pendingRequestId by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var kind by remember { mutableStateOf("assignment_pdf") }
    var downloadId by remember { mutableStateOf<String?>(null) }
    var downloadName by remember { mutableStateOf("ava-result.pdf") }

    suspend fun refresh() {
        try {
            val taskResponse = api.avaTasks()
            if (taskResponse.isSuccessful) { tasks = taskResponse.body()?.tasks.orEmpty(); workerOnline = taskResponse.body()?.workerOnline == true }
            else error = "Could not refresh Ava tasks (HTTP ${taskResponse.code()})."
        } catch (_: Exception) {
            error = "Ava task service is temporarily unavailable."
        } finally { loading = false }
    }

    LaunchedEffect(Unit) {
        try {
            val response = api.documents()
            if (response.isSuccessful) documents = response.body()?.documents.orEmpty().filter { it.status == "READY" }
            else error = "Could not load uploaded documents (HTTP ${response.code()})."
        } catch (_: Exception) { error = "Document library is unavailable. Check your connection." }
        refresh()
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            delay(5000)
            refresh()
        }
    }

    val savePdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val id = downloadId
        if (uri != null && id != null) scope.launch {
            try {
                val response = api.downloadDocument(id)
                if (!response.isSuccessful) throw IllegalStateException("PDF download failed (HTTP ${response.code()}).")
                val bytes = response.body()?.bytes() ?: throw IllegalStateException("The server returned an empty PDF.")
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw IllegalStateException("Could not save the PDF to this device.")
                error = null
            } catch (e: Exception) { error = e.message ?: "PDF download failed." }
            finally { downloadId = null }
        }
    }

    Column(
        Modifier.fillMaxWidth().background(AvaCanvas).padding(18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("AVA / BACKGROUND TASKS", color = AvaGold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Text("Choose uploaded material and let Ava work on it. Jobs continue on the server after you leave this screen.", color = AvaMuted, fontSize = 12.sp)
        Text(if (workerOnline) "BACKGROUND WORKER ONLINE" else "BACKGROUND WORKER OFFLINE — background tasks are unavailable until the worker is started.", color = if (workerOnline) Color(0xFF7DD3A7) else AvaGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Text("TASK TYPE", color = AvaCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = kind == "assignment_pdf", onClick = { kind = "assignment_pdf" }, label = { Text("Worked assignment PDF") })
            FilterChip(selected = kind == "study_summary_pdf", onClick = { kind = "study_summary_pdf" }, label = { Text("Study summary PDF") })
        }
        Text("SOURCE DOCUMENTS", color = AvaCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        if (documents.isEmpty()) Text("No ready documents are available. Upload an assignment or study document first.", color = AvaMuted, fontSize = 12.sp)
        documents.forEach { document ->
            Surface(color = AvaPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Checkbox(checked = document.id in selectedIds, onCheckedChange = { checked ->
                        selectedIds = if (checked) selectedIds + document.id else selectedIds - document.id
                    })
                    Column(Modifier.weight(1f)) {
                        Text(document.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                        Text(document.filename, color = AvaMuted, fontSize = 10.sp)
                    }
                }
            }
        }
        OutlinedTextField(
            value = prompt, onValueChange = { prompt = it }, modifier = Modifier.fillMaxWidth(),
            label = { Text("Extra instructions (optional)") }, minLines = 2
        )
        Button(
            onClick = {
                scope.launch {
                    creating = true
                    error = null
                    try {
                        val requestId = pendingRequestId ?: UUID.randomUUID().toString().also { pendingRequestId = it }
                        val response = api.createAvaTask(AvaTaskCreateRequest(kind, selectedIds.toList(), prompt.trim(), requestId))
                        if (!response.isSuccessful || response.body()?.task == null) {
                            error = response.body()?.error ?: "Ava could not queue this task (HTTP ${response.code()})."
                        } else {
                            pendingRequestId = null
                            selectedIds = emptySet()
                            prompt = ""
                            refresh()
                        }
                    } catch (_: Exception) { error = "Could not connect to Ava. Your task was not submitted." }
                    finally { creating = false }
                }
            },
            enabled = selectedIds.isNotEmpty() && !creating && workerOnline,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = AvaCyan, contentColor = AvaCanvas),
            shape = RoundedCornerShape(6.dp)
        ) { Text(if (creating) "QUEUING TASK…" else "START AVA TASK", fontWeight = FontWeight.Bold) }

        Text("TASK HISTORY", color = AvaGold, fontSize = 11.sp, letterSpacing = 1.3.sp, fontWeight = FontWeight.Bold)
        if (loading) CircularProgressIndicator(color = AvaCyan)
        if (!loading && tasks.isEmpty()) Text("No Ava tasks have been submitted yet.", color = AvaMuted)
        tasks.forEach { task ->
            Surface(color = AvaPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text(if (task.kind == "assignment_pdf") "ASSIGNMENT SOLUTIONS" else "STUDY SUMMARY", color = AvaCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        Text(task.status, color = if (task.status == "FAILED") Color(0xFFFF7D78) else AvaGold, fontSize = 10.sp)
                    }
                    Text(task.currentStep, color = Color.White, fontSize = 12.sp)
                    LinearProgressIndicator(progress = task.progress.coerceIn(0, 100) / 100f, modifier = Modifier.fillMaxWidth(), color = AvaCyan, trackColor = Color(0xFF26384B))
                    Text("${task.progress}% complete", color = AvaMuted, fontSize = 10.sp)
                    task.errorMessage?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 11.sp) }
                    if (!task.resultDocumentId.isNullOrBlank()) {
                        OutlinedButton(onClick = {
                            downloadId = task.resultDocumentId
                            downloadName = "ava-${task.id.take(8)}.pdf"
                            savePdf.launch(downloadName)
                        }) { Text("SAVE GENERATED PDF", color = AvaCyan) }
                    }
                    if (task.status == "QUEUED") TextButton(onClick = {
                        scope.launch {
                            val result = api.cancelAvaTask(task.id)
                            if (result.isSuccessful) refresh() else error = "This task has already started or could not be cancelled."
                        }
                    }) { Text("CANCEL QUEUED TASK", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                }
            }
        }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        OutlinedButton(onClick = { scope.launch { loading = true; refresh() } }, modifier = Modifier.fillMaxWidth()) { Text("REFRESH TASKS", color = AvaCyan) }
    }
}
