package com.kyro.classdesk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyro.classdesk.data.ChatHistoryItem
import com.kyro.classdesk.data.AvaActionConfirmationDto
import com.kyro.classdesk.data.ChatRequest
import com.kyro.classdesk.data.ClassDeskApi
import kotlinx.coroutines.launch
import java.util.UUID

private data class AvaChatMessage(val role: String, val content: String)

@Composable
fun AvaChatScreen(api: ClassDeskApi, onOpenTools: () -> Unit) {
    val scope = rememberCoroutineScope()
    var messages by remember { mutableStateOf(listOf(
        AvaChatMessage("assistant", "Hello. I'm Ava, your ClassDesk assistant. Ask me about your courses, uploaded notes, assignments, class records or anything else you need help with.")
    )) }
    var draft by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<AvaActionConfirmationDto?>(null) }

    Column(
        Modifier.fillMaxWidth().background(Color(0xFF0A1019)).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("AVA / CLASSDESK AI", color = Color(0xFF42D9F5), fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.Bold)
                Text("Text chat · Your ClassDesk session and permissions apply", color = Color(0xFF91A4B8), fontSize = 10.sp)
            }
            OutlinedButton(onClick = onOpenTools, enabled = !busy, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)) {
                Icon(Icons.Default.Build, contentDescription = null, tint = Color(0xFFF2C94C), modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(5.dp))
                Text("TOOLS", color = Color(0xFFF2C94C), fontSize = 10.sp)
            }
        }
        HorizontalDivider(color = Color(0xFF26384B))
        LazyColumn(
            modifier = Modifier.weight(1f, fill = false).fillMaxWidth().heightIn(min = 260.dp, max = 520.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            itemsIndexed(messages) { _, message ->
                val isAva = message.role == "assistant"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (isAva) Arrangement.Start else Arrangement.End) {
                    Surface(
                        color = if (isAva) Color(0xFF142437) else Color(0xFF173B4B),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.widthIn(max = 330.dp)
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(if (isAva) "AVA" else "YOU", color = if (isAva) Color(0xFF42D9F5) else Color(0xFFF2C94C), fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                            Text(message.content, color = Color(0xFFE5EDF5), fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                }
            }
            if (busy) item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(color = Color(0xFF42D9F5), modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Ava is thinking…", color = Color(0xFF91A4B8), fontSize = 12.sp)
                }
            }
        }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it; error = null },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message Ava…") },
                minLines = 1,
                maxLines = 5,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    val prompt = draft.trim()
                    if (prompt.isNotEmpty() && !busy) {
                        draft = ""
                        messages = messages + AvaChatMessage("user", prompt)
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                val history = messages.dropLast(1).takeLast(6).map { ChatHistoryItem(it.role, it.content) }
                                val response = api.chat(ChatRequest(
                                    message = prompt,
                                    voice = false,
                                    history = history,
                                    clientRequestId = UUID.randomUUID().toString()
                                ))
                                val answer = response.body()?.answer
                                if (response.isSuccessful && !answer.isNullOrBlank()) {
                                    messages = messages + AvaChatMessage("assistant", answer)
                                    pendingDelete = response.body()?.actionConfirmation
                                } else {
                                    error = response.body()?.error ?: "Ava could not complete that request (HTTP ${response.code()})."
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Could not reach Ava. Check your connection and try again."
                            } finally { busy = false }
                        }
                    }
                }),
                shape = RoundedCornerShape(7.dp)
            )
            FilledIconButton(
                onClick = {
                    val prompt = draft.trim()
                    if (prompt.isNotEmpty() && !busy) {
                        draft = ""
                        messages = messages + AvaChatMessage("user", prompt)
                        busy = true
                        error = null
                        scope.launch {
                            try {
                                val history = messages.dropLast(1).takeLast(6).map { ChatHistoryItem(it.role, it.content) }
                                val response = api.chat(ChatRequest(
                                    message = prompt,
                                    voice = false,
                                    history = history,
                                    clientRequestId = UUID.randomUUID().toString()
                                ))
                                val answer = response.body()?.answer
                                if (response.isSuccessful && !answer.isNullOrBlank()) {
                                    messages = messages + AvaChatMessage("assistant", answer)
                                    pendingDelete = response.body()?.actionConfirmation
                                } else error = response.body()?.error ?: "Ava could not complete that request (HTTP ${response.code()})."
                            } catch (e: Exception) {
                                error = e.message ?: "Could not reach Ava. Check your connection and try again."
                            } finally { busy = false }
                        }
                    }
                },
                enabled = draft.isNotBlank() && !busy,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019))
            ) { Icon(Icons.Default.Send, contentDescription = "Send message") }
        }
        Text("Ava uses the same ClassDesk AI endpoint as the website. Open Tools for the native document and admin utilities available to your account.", color = Color(0xFF91A4B8), fontSize = 10.sp)
    }
    pendingDelete?.let { action ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Confirm permanent deletion") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(action.title, fontWeight = FontWeight.Bold)
                    Text(action.filename, color = Color(0xFF91A4B8))
                    Text("This removes the database record, extracted text, indexed chunks" + if (action.originalInSharedStorage) " and original shared-storage file." else ".")
                    Text("This action cannot be undone.", color = Color(0xFFFF7D78))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        busy = true
                        try {
                            val result = api.avaTool(mapOf(
                                "action" to "delete_document",
                                "documentId" to action.documentId,
                                "confirmPermanent" to true,
                                "confirmTitle" to action.title
                            ))
                            val deleted = result.body()?.get("deleted") as? Map<*, *>
                            if (!result.isSuccessful || deleted?.get("databaseRecord") != true ||
                                (action.originalInSharedStorage && deleted["sharedStorageObject"] != true)) {
                                throw IllegalStateException(result.body()?.get("error")?.toString() ?: "Deletion could not be verified (HTTP ${result.code()}).")
                            }
                            messages = messages + AvaChatMessage("assistant", "Verified: ${action.title} was deleted from ClassDesk" + if (action.originalInSharedStorage) " and shared storage." else ".")
                            pendingDelete = null
                        } catch (e: Exception) {
                            error = e.message ?: "Permanent deletion failed."
                        } finally { busy = false }
                    }
                }) { Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78)) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("CANCEL") } }
        )
    }
}
