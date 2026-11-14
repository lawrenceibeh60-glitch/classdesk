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
import com.google.gson.Gson
import com.kyro.classdesk.data.ClassDeskApi
import kotlinx.coroutines.launch

private val ToolCanvas = Color(0xFF0A1019)
private val ToolPanel = Color(0xFF111B28)
private val ToolCyan = Color(0xFF42D9F5)
private val ToolGold = Color(0xFFF2C94C)
private val ToolMuted = Color(0xFF91A4B8)

@Composable
fun AvaToolsScreen(api: ClassDeskApi, isPrimaryAdmin: Boolean) {
    val scope = rememberCoroutineScope()
    var sql by remember { mutableStateOf("SELECT \"id\", \"title\", \"status\", \"createdAt\" FROM \"Document\" ORDER BY \"createdAt\" DESC") }
    var search by remember { mutableStateOf("") }
    var resultText by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var documents by remember { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var documentText by remember { mutableStateOf("") }
    var auditText by remember { mutableStateOf("") }

    suspend fun runTool(payload: Map<String, Any>): Map<String, Any> {
        val response = api.avaTool(payload)
        val body = response.body()
        if (!response.isSuccessful) throw IllegalStateException(body?.get("error")?.toString() ?: "Ava tool request failed (HTTP ${response.code()}).")
        return body ?: throw IllegalStateException("Ava tool returned an empty response.")
    }

    Column(
        Modifier.fillMaxWidth().background(ToolCanvas).padding(18.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("AVA / ADMIN TOOLS", color = ToolGold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Text("Search and read uploaded documents. The SQL console is read-only and restricted to approved ClassDesk tables.", color = ToolMuted, fontSize = 12.sp)

        Text("DOCUMENT SEARCH", color = ToolCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(search, { search = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Title, filename or topic") }, singleLine = true)
        Button(onClick = {
            scope.launch {
                busy = true; error = null
                try {
                    val result = runTool(mapOf("action" to "search_documents", "query" to search))
                    documents = (result["documents"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
                } catch (e: Exception) { error = e.message ?: "Document search failed." }
                finally { busy = false }
            }
        }, enabled = search.isNotBlank() && !busy, colors = ButtonDefaults.buttonColors(containerColor = ToolCyan, contentColor = ToolCanvas)) {
            Text("SEARCH DOCUMENTS")
        }
        documents.forEach { document ->
            Surface(color = ToolPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(document["title"]?.toString() ?: "Untitled document", color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text(document["filename"]?.toString() ?: "", color = ToolMuted, fontSize = 10.sp)
                    TextButton(onClick = {
                        val id = document["id"]?.toString() ?: return@TextButton
                        scope.launch {
                            busy = true; error = null
                            try {
                                val result = runTool(mapOf("action" to "read_document", "documentId" to id))
                                val detail = result["document"] as? Map<*, *>
                                documentText = detail?.get("extractedText")?.toString().orEmpty()
                                if (detail?.get("truncated") == true) documentText += "\n\n[Text truncated by the server for safety.]"
                            } catch (e: Exception) { error = e.message ?: "Could not read document." }
                            finally { busy = false }
                        }
                    }) { Text("READ EXTRACTED TEXT", color = ToolCyan) }
                }
            }
        }
        if (documentText.isNotBlank()) {
            Text("DOCUMENT CONTENT", color = ToolGold, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Surface(color = ToolPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Text(documentText, color = Color.White, modifier = Modifier.padding(12.dp), fontSize = 12.sp)
            }
        }

        if (isPrimaryAdmin) {
            HorizontalDivider(color = Color(0xFF26384B))
            Text("SQL SELECT CONSOLE", color = ToolCyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(sql, { sql = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Read-only SQL") }, minLines = 4)
            Button(onClick = {
                scope.launch {
                    busy = true; error = null
                    try {
                        val result = runTool(mapOf("action" to "sql_select", "query" to sql))
                        resultText = Gson().toJson(result["rows"])
                    } catch (e: Exception) { error = e.message ?: "SQL query failed."; resultText = "" }
                    finally { busy = false }
                }
            }, enabled = sql.isNotBlank() && !busy, colors = ButtonDefaults.buttonColors(containerColor = ToolCyan, contentColor = ToolCanvas)) {
                Text(if (busy) "RUNNING…" else "EXECUTE SELECT")
            }
            if (resultText.isNotBlank()) Surface(color = ToolPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Text(resultText, color = Color.White, modifier = Modifier.padding(12.dp), fontSize = 10.sp)
            }
            OutlinedButton(onClick = {
                scope.launch {
                    busy = true; error = null
                    try {
                        val result = runTool(mapOf("action" to "list_audit_logs"))
                        auditText = Gson().toJson(result["events"])
                    } catch (e: Exception) { error = e.message ?: "Audit history could not be loaded." }
                    finally { busy = false }
                }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("LOAD PRIVILEGED ACTION AUDIT", color = ToolGold) }
            if (auditText.isNotBlank()) Surface(color = ToolPanel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                Text(auditText, color = ToolMuted, modifier = Modifier.padding(12.dp), fontSize = 10.sp)
            }
        } else {
            Text("SQL and privileged administration tools are available only to the Class Representative.", color = ToolMuted, fontSize = 11.sp)
        }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
    }
}
