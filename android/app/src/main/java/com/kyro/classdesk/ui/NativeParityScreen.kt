package com.kyro.classdesk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyro.classdesk.data.*
import kotlinx.coroutines.launch

private val NativeCanvas = Color(0xFF0A1019)
private val NativePanel = Color(0xFF111B28)
private val NativeCyan = Color(0xFF42D9F5)
private val NativeGold = Color(0xFFF2C94C)
private val NativeMuted = Color(0xFF91A4B8)

/** Native views backed by the same authenticated ClassDesk API as the website. */
@Composable
fun NativeParityScreen(section: String, api: ClassDeskApi, user: UserDto) {
    val scope = rememberCoroutineScope()
    var courses by remember { mutableStateOf<List<CourseDto>>(emptyList()) }
    var lectures by remember { mutableStateOf<List<LectureDto>>(emptyList()) }
    var assignments by remember { mutableStateOf<List<AssignmentDto>>(emptyList()) }
    var records by remember { mutableStateOf<List<AcademicRecordDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var health by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }
    var storage by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }
    var cleanupPhrase by remember { mutableStateOf("") }
    var cleanupMessage by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        loading = true
        error = null
        try {
            val c = api.courses()
            val l = api.lectures()
            val a = api.assignments()
            val r = api.records(limit = 200, upcoming = 0)
            if (c.isSuccessful) courses = c.body()?.items.orEmpty() else error = "Courses could not be refreshed (${c.code()})."
            if (l.isSuccessful) lectures = l.body()?.items.orEmpty() else error = error ?: "Lectures could not be refreshed (${l.code()})."
            if (a.isSuccessful) assignments = a.body()?.items.orEmpty() else error = error ?: "Assignments could not be refreshed (${a.code()})."
            if (r.isSuccessful) records = r.body()?.records.orEmpty() else error = error ?: "Class records could not be refreshed (${r.code()})."
            if (section == "Settings") {
                val h = api.health()
                if (h.isSuccessful) health = h.body().orEmpty() else error = error ?: "System health could not be checked (${h.code()})."
                val st = api.storageStats()
                if (st.isSuccessful) storage = st.body().orEmpty() else error = error ?: "Storage administration is unavailable (${st.code()})."
            }
        } catch (_: Exception) {
            error = "ClassDesk could not connect. Check your connection; your account data has not been changed."
        } finally { loading = false }
    }

    LaunchedEffect(section) { load() }
    Column(Modifier.fillMaxSize().background(NativeCanvas).verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("CLASSDESK / ${section.uppercase()}", color = NativeGold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Text(when (section) {
            "Catch-up Centre" -> "A focused view of missed work and upcoming academic activity."
            "Coverage" -> "Course-by-course lecture activity, calculated from the shared class register."
            "Class Records" -> "Search the shared academic record timeline."
            else -> "Account and application diagnostics."
        }, color = NativeMuted, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { scope.launch { load() } }, shape = RoundedCornerShape(6.dp)) { Text("REFRESH", color = NativeCyan) }
            if (loading) CircularProgressIndicator(color = NativeCyan, modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
        }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        when (section) {
            "Catch-up Centre" -> {
                val now = System.currentTimeMillis()
                val pending = assignments.filter { !it.status.equals("DONE", true) }
                val overdue = pending.filter { it.dueAt?.let { due -> runCatching { java.time.Instant.parse(due).toEpochMilli() < now }.getOrDefault(false) } == true }
                val upcoming = pending - overdue.toSet()
                ParityMetric("OVERDUE ASSIGNMENTS", overdue.size)
                ParityMetric("OPEN ASSIGNMENTS", pending.size)
                ParityMetric("LECTURE SESSIONS", lectures.size)
                Text("PRIORITY / OVERDUE", color = NativeGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                if (overdue.isEmpty()) Text("No overdue assignments are currently recorded.", color = NativeMuted)
                overdue.forEach { AssignmentLine(it, "OVERDUE") }
                Text("UP NEXT", color = NativeGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                if (upcoming.isEmpty()) Text("No other open assignments are currently recorded.", color = NativeMuted)
                upcoming.sortedBy { it.dueAt.orEmpty() }.forEach { AssignmentLine(it, "OPEN") }
                Text("RECENT LECTURES", color = NativeGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                lectures.take(8).forEach { lecture -> ParityCard(lecture.topic, listOfNotNull(lecture.course?.code, lecture.heldAt ?: lecture.scheduledAt, lecture.venue).joinToString(" / ")) }
            }
            "Coverage" -> {
                if (courses.isEmpty()) Text("No courses are registered yet.", color = NativeMuted)
                courses.forEach { course ->
                    val related = lectures.filter { it.course?.id == course.id || it.course?.code == course.code }
                    val latest = related.firstOrNull()?.let { it.heldAt ?: it.scheduledAt } ?: "No lecture date recorded"
                    Surface(color = NativePanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(course.code, color = NativeCyan, fontWeight = FontWeight.Bold)
                            Text(course.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text("${related.size} lecture session(s) recorded", color = NativeGold, fontSize = 12.sp)
                            Text("Latest activity: ${latest}", color = NativeMuted, fontSize = 11.sp)
                        }
                    }
                }
                Text("Coverage counts verified lecture records; it does not assume a departmental syllabus or claim that a topic is complete.", color = NativeMuted, fontSize = 11.sp)
            }
            "Class Records" -> {
                OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search title or content") }, singleLine = true)
                val filtered = records.filter { it.title.contains(query, true) || it.content.contains(query, true) || it.type.contains(query, true) }
                Text("${filtered.size} record(s)", color = NativeMuted, fontSize = 11.sp)
                filtered.forEach { record -> ParityCard(record.title, "${record.type} / ${record.status} / ${record.eventDate.orEmpty()}\n${record.content.take(240)}") }
                if (!loading && filtered.isEmpty()) Text("No matching records were found.", color = NativeMuted)
            }
            else -> {
                ParityCard("SIGNED-IN ACCOUNT", user.displayName)
                ParityCard("USERNAME", user.username)
                ParityCard("ACCESS ROLE", user.role.replace('_', ' '))
                ParityCard("SESSION SECURITY", "Session cookies are stored using Android encrypted preferences.")
                ParityCard("MICROPHONE PRIVACY", "Ava only requests microphone access after you tap its microphone control.")
                ParityCard("SHARED DATA", "The Android app and website use the same authenticated ClassDesk account and backend.")
                Text("SYSTEM HEALTH", color = NativeGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                ParityCard("DATABASE", if (health["databaseReachable"] == true) "Reachable" else "Unavailable / not verified")
                ParityCard("OBJECT STORAGE", if (health["storageConfigured"] == true) "Configured" else "Not configured")
                ParityCard("AI SERVICE", if (health["aiConfigured"] == true) "Configured" else "Not configured")
                ParityCard("SPEECH SERVICES", "STT: ${health["sttConfigured"] == true} / TTS: ${health["ttsConfigured"] == true}")
                Text("SQL STORAGE / ADMINISTRATION", color = NativeGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                val counts = storage["counts"] as? Map<*, *> ?: emptyMap<Any, Any>()
                counts.forEach { (key, value) -> ParityCard(key.toString(), value.toString()) }
                val dbBytes = storage["databaseBytes"]?.toString() ?: "Not available"
                ParityCard("DATABASE SIZE", dbBytes + " bytes")
                if (user.role == "CLASS_REP") {
                    OutlinedTextField(cleanupPhrase, { cleanupPhrase = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Type CLEANUP_CLASSDESK_SQL to confirm temporary-data cleanup") }, singleLine = true)
                    Button(onClick = {
                        scope.launch {
                            try {
                                val result = api.cleanupStorage(mapOf("confirmation" to cleanupPhrase, "retentionDays" to 30))
                                if (result.isSuccessful) {
                                    cleanupMessage = "Temporary SQL data cleanup completed. Class content is not deleted."
                                    cleanupPhrase = ""
                                    load()
                                } else cleanupMessage = "Cleanup was rejected (${result.code()})."
                            } catch (_: Exception) { cleanupMessage = "Cleanup service could not be reached." }
                        }
                    }, enabled = cleanupPhrase == "CLEANUP_CLASSDESK_SQL") { Text("CLEAN TEMPORARY SQL DATA") }
                    cleanupMessage?.let { Text(it, color = NativeCyan, fontSize = 11.sp) }
                }
                Text("Backups and restore are available in More / Backup & Export. Destructive document deletion remains in the Document Library and is protected by server-side permissions.", color = NativeMuted, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun ParityMetric(label: String, value: Int) {
    Surface(color = NativePanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = NativeMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Text(value.toString(), color = NativeCyan, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ParityCard(title: String, detail: String) {
    Surface(color = NativePanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(detail.ifBlank { "No additional details." }, color = NativeMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun AssignmentLine(item: AssignmentDto, state: String) {
    ParityCard(item.title, "${state} / ${item.course?.code.orEmpty()} / ${item.dueAt.orEmpty()}")
}
