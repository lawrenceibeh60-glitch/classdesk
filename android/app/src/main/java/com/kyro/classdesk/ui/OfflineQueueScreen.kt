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
import com.google.gson.Gson
import com.kyro.classdesk.data.AcademicRecordDto
import com.kyro.classdesk.data.ClassDeskSyncScheduler
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
    var discardTarget by remember { mutableStateOf<OfflineQueueEntry?>(null) }
    var actionMessage by remember { mutableStateOf<String?>(null) }

    fun refresh() {
        val store = OfflineStore(context)
        try { entries = store.entries(user.username) } finally { store.closeStore() }
    }

    fun discard(entry: OfflineQueueEntry) {
        val store = OfflineStore(context)
        try { store.removeEntry(entry.id) } finally { store.closeStore() }
        actionMessage = "The selected local change was discarded from this device."
        refresh()
    }

    fun acceptCloud(entry: OfflineQueueEntry) {
        val store = OfflineStore(context)
        try { store.removeEntry(entry.id) } finally { store.closeStore() }
        actionMessage = "The cloud version was kept. The conflicting local change was removed from the queue."
        refresh()
    }

    fun keepLocal(entry: OfflineQueueEntry, serverRecord: AcademicRecordDto?) {
        val store = OfflineStore(context)
        try { store.rebaseForRetry(entry.id, serverRecord?.version ?: 0) } finally { store.closeStore() }
        ClassDeskSyncScheduler.scheduleNow(context)
        actionMessage = "Your local change was rebased against the latest cloud version and queued for retry."
        refresh()
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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            Button(
                onClick = { ClassDeskSyncScheduler.scheduleNow(context); actionMessage = "Sync requested. It will run when a network connection is available." },
                enabled = pending > 0,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019)),
                shape = RoundedCornerShape(6.dp)
            ) { Text("SYNC NOW") }
            OutlinedButton(onClick = { refresh() }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(6.dp)) {
                Text("REFRESH", color = Color(0xFF42D9F5))
            }
        }
        Text("Changes are encrypted on this device and synchronised only under the account that created them. A conflict means the cloud record changed while this device was offline; choose which version to keep. Rejected changes are not retried automatically.", color = Color(0xFF91A4B8), fontSize = 11.sp)
        actionMessage?.let { Text(it, color = Color(0xFF42D9F5), fontSize = 11.sp) }
        if (entries.isEmpty()) Text("No offline changes are waiting.", color = Color(0xFF91A4B8))
        entries.forEach { entry ->
            val cloudRecord = if (entry.status == "CONFLICT") runCatching {
                entry.serverRecordJson?.let { Gson().fromJson(it, AcademicRecordDto::class.java) }
            }.getOrNull() else null
            Surface(color = Color(0xFF111B28), shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("${entry.status} / ${entry.operation.uppercase()}", color = when (entry.status) {
                        "PENDING" -> Color(0xFF42D9F5)
                        "CONFLICT" -> Color(0xFFF2C94C)
                        else -> Color(0xFFFF7D78)
                    }, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    Text("Record ${entry.entityId}", color = Color.White, fontSize = 12.sp)
                    Text(SimpleDateFormat("dd MMM yyyy, HH:mm", Locale.UK).format(Date(entry.createdAt)), color = Color(0xFF91A4B8), fontSize = 10.sp)
                    entry.lastError?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 11.sp) }

                    if (entry.status == "CONFLICT") {
                        Text(
                            if (entry.serverRecordPresent && cloudRecord == null) "The saved cloud snapshot could not be decrypted. Do not retry against an unknown version."
                            else if (cloudRecord == null) "The cloud record no longer exists."
                            else "Cloud version: ${cloudRecord.title} / ${cloudRecord.status} / version ${cloudRecord.version}",
                            color = Color(0xFFF2C94C), fontSize = 11.sp
                        )
                        if (entry.serverRecordPresent && cloudRecord == null) {
                            TextButton(onClick = { discardTarget = entry }) {
                                Text("DISCARD LOCAL CHANGE", color = Color(0xFFFF7D78), fontSize = 10.sp)
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                OutlinedButton(
                                    onClick = { acceptCloud(entry) },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(6.dp)
                                ) { Text(if (entry.operation == "delete" && cloudRecord == null) "ACCEPT DELETION" else "USE CLOUD", color = Color(0xFF42D9F5), fontSize = 10.sp) }
                                Button(
                                    onClick = {
                                        if (entry.operation == "delete" && cloudRecord == null) acceptCloud(entry)
                                        else keepLocal(entry, cloudRecord)
                                    },
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF2C94C), contentColor = Color(0xFF0A1019)),
                                    shape = RoundedCornerShape(6.dp)
                                ) { Text(if (entry.operation == "delete" && cloudRecord == null) "ALREADY DELETED" else "KEEP LOCAL", fontSize = 10.sp) }
                            }
                        }
                    } else if (entry.status == "REJECTED" || entry.status == "CORRUPT") {
                        Text("This item will not retry automatically. Review the error above before discarding it.", color = Color(0xFF91A4B8), fontSize = 10.sp)
                        TextButton(onClick = { discardTarget = entry }) {
                            Text("DISCARD LOCAL CHANGE", color = Color(0xFFFF7D78), fontSize = 10.sp)
                        }
                    }
                }
            }
        }
    }

    discardTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { discardTarget = null },
            title = { Text("Discard this local change?") },
            text = { Text("This removes the queued item from this device. It does not change the cloud record.") },
            confirmButton = {
                TextButton(onClick = { discard(target); discardTarget = null }) {
                    Text("DISCARD", color = Color(0xFFFF7D78))
                }
            },
            dismissButton = { TextButton(onClick = { discardTarget = null }) { Text("CANCEL") } }
        )
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
