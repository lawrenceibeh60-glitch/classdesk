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
import androidx.compose.ui.platform.LocalContext
import com.kyro.classdesk.data.OfflineQueueEntry
import com.kyro.classdesk.data.OfflineStore
import com.kyro.classdesk.data.UserDto
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun OfflineQueueScreen(user: UserDto) {
    val context = LocalContext.current
    var entries by remember { mutableStateOf<List<OfflineQueueEntry>>(emptyList()) }
    fun refresh() {
        val store = OfflineStore(context)
        try { entries = store.entries(user.username) } finally { store.closeStore() }
    }
    LaunchedEffect(user.username) { refresh() }
    val pending = entries.count { it.status == "PENDING" }
    val conflicts = entries.count { it.status == "CONFLICT" }
    val rejected = entries.count { it.status == "REJECTED" || it.status == "CORRUPT" }

    Column(
        Modifier.fillMaxWidth().background(Color(0xFF0A1019)).padding(18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("OFFLINE / SYNCHRONISATION QUEUE", color = Color(0xFFF2C94C), fontSize = 11.sp, letterSpacing = 1.3.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QueueMetric("PENDING", pending, Modifier.weight(1f))
            QueueMetric("CONFLICTS", conflicts, Modifier.weight(1f))
            QueueMetric("NEEDS REVIEW", rejected, Modifier.weight(1f))
        }
        OutlinedButton(onClick = { refresh() }, modifier = Modifier.fillMaxWidth()) { Text("REFRESH QUEUE", color = Color(0xFF42D9F5)) }
        Text("Queued calendar, timetable, academic and announcement changes are encrypted on this device and synchronised only under the account that created them. Conflicts and rejected changes remain available for review.", color = Color(0xFF91A4B8), fontSize = 11.sp)
        if (entries.isEmpty()) Text("No offline changes are waiting.", color = Color(0xFF91A4B8))
        entries.forEach { entry ->
            Surface(color = Color(0xFF111B28), shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("\${entry.status} / \${entry.operation.uppercase()}", color = when (entry.status) {
                        "PENDING" -> Color(0xFF42D9F5)
                        "CONFLICT" -> Color(0xFFF2C94C)
                        else -> Color(0xFFFF7D78)
                    }, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text("Record \${entry.entityId}", color = Color.White, fontSize = 12.sp)
                    Text(SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.UK).format(Date(entry.createdAt)), color = Color(0xFF91A4B8), fontSize = 10.sp)
                    entry.lastError?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 11.sp) }
                }
            }
        }
    }
}

@Composable
private fun QueueMetric(label: String, value: Int, modifier: Modifier) {
    Surface(color = Color(0xFF111B28), shape = RoundedCornerShape(6.dp), modifier = modifier) {
        Column(Modifier.padding(10.dp)) {
            Text(label, color = Color(0xFF91A4B8), fontSize = 9.sp)
            Text(value.toString(), color = Color(0xFF42D9F5), fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}
