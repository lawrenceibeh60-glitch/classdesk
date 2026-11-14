package com.kyro.classdesk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.kyro.classdesk.BuildConfig
import com.kyro.classdesk.data.*
import kotlinx.coroutines.launch

private val Canvas = Color(0xFF0A1019)
private val Panel = Color(0xFF111B28)
private val Cyan = Color(0xFF42D9F5)
private val Muted = Color(0xFF91A4B8)
private val Gold = Color(0xFFF2C94C)

@Composable
fun ClassDeskApp() {
    val context = LocalContext.current
    val api = remember { ApiClient.get(context) }
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<UserDto?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var summary by remember { mutableStateOf<SummaryDto?>(null) }
    var upcoming by remember { mutableStateOf<List<AssignmentDto>>(emptyList()) }

    suspend fun refreshSession() {
        try {
            val response = api.session()
            if (response.isSuccessful) {
                user = response.body()?.user
                if (user != null) {
                    ClassDeskSyncScheduler.schedule(context)
                    val data = api.summary()
                    if (data.isSuccessful) {
                        summary = data.body()?.summary
                        upcoming = data.body()?.upcomingAssignments.orEmpty()
                    }
                }
            } else user = null
        } catch (e: Exception) {
            error = e.message ?: "Unable to connect to ClassDesk"
        } finally { loading = false }
    }

    LaunchedEffect(Unit) { refreshSession() }

    when {
        loading -> Box(Modifier.fillMaxSize().background(Canvas), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Cyan)
        }
        user == null -> LoginScreen(
            error = error,
            onLogin = { username, password ->
                scope.launch {
                    loading = true
                    error = null
                    try {
                        val response = api.login(LoginRequest(username.trim(), password))
                        if (response.isSuccessful && response.body()?.ok == true) refreshSession()
                        else {
                            error = response.body()?.error ?: "Sign-in failed. Check your details."
                            loading = false
                        }
                    } catch (_: Exception) {
                        error = "Connection failed. Check your internet and configured server address."
                        loading = false
                    }
                }
            }
        )
        else -> DashboardScreen(
            user = user!!,
            api = api,
            summary = summary,
            upcoming = upcoming,
            onRefresh = { scope.launch { loading = true; refreshSession() } },
            onLogout = {
                ApiClient.cookies(context).clear()
                user = null
                summary = null
                upcoming = emptyList()
            }
        )
    }
}

@Composable
private fun LoginScreen(error: String?, onLogin: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Canvas).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("AFIT / CLASSDESK", color = Cyan, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Spacer(Modifier.height(12.dp))
        Text("Your class command centre.", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("Sign in with your authorised ClassDesk account.", color = Muted)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true)
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        if (error != null) {
            Spacer(Modifier.height(12.dp))
            Text(error, color = Color(0xFFFF7D78), fontSize = 13.sp)
        }
        Spacer(Modifier.height(18.dp))
        Button(onClick = { onLogin(username, password) }, enabled = username.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) {
            Text("SIGN IN", fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 7.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text("PRIVATE STAFF ACCESS  /  ENCRYPTED SESSION", color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
        Text("API: ${BuildConfig.API_BASE_URL}", color = Muted, fontSize = 10.sp)
    }
}

@Composable
private fun DashboardScreen(user: UserDto, api: ClassDeskApi, summary: SummaryDto?, upcoming: List<AssignmentDto>, onRefresh: () -> Unit, onLogout: () -> Unit) {
    var selected by remember { mutableStateOf("Overview") }
    var courses by remember { mutableStateOf<List<CourseDto>>(emptyList()) }
    var assignments by remember { mutableStateOf<List<AssignmentDto>>(emptyList()) }
    var moduleLoading by remember { mutableStateOf(false) }
    var moduleError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(selected) {
        moduleError = null
        if (selected == "Courses" || selected == "Tasks") {
            moduleLoading = true
            try {
                if (selected == "Courses") {
                    val response = api.courses()
                    if (response.isSuccessful) courses = response.body()?.items.orEmpty()
                    else moduleError = "Could not load courses (${response.code()})"
                } else {
                    val response = api.assignments()
                    if (response.isSuccessful) assignments = response.body()?.items.orEmpty()
                    else moduleError = "Could not load assignments (${response.code()})"
                }
            } catch (_: Exception) { moduleError = "Unable to connect. Your saved session may need refreshing." }
            finally { moduleLoading = false }
        }
    }
    Scaffold(
        containerColor = Canvas,
        topBar = {
            Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("AFIT CLASSDESK", color = Cyan, fontSize = 11.sp, letterSpacing = 1.8.sp, fontWeight = FontWeight.Bold)
                    Text("COMMAND / ${user.role.replace('_', ' ')}", color = Muted, fontSize = 10.sp)
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh", tint = Cyan) }
                IconButton(onClick = onLogout) { Icon(Icons.Default.Logout, "Sign out", tint = Gold) }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Panel, contentColor = Cyan) {
                listOf("Overview", "Courses", "Tasks", "Ava").forEach { item ->
                    NavigationBarItem(selected = selected == item, onClick = { selected = item },
                        icon = { Icon(when (item) {
                            "Courses" -> Icons.Default.MenuBook
                            "Tasks" -> Icons.Default.CheckCircle
                            "Ava" -> Icons.Default.GraphicEq
                            else -> Icons.Default.Dashboard
                        }, contentDescription = item) },
                        label = { Text(item) })
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Good day, ${user.displayName}", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("ND1 / ELECTRICAL & ELECTRONICS ENGINEERING", color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
            if (selected == "Overview") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricCard("COURSES", summary?.courses ?: 0, Modifier.weight(1f))
                    MetricCard("LECTURES", summary?.lectures ?: 0, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    MetricCard("OPEN TASKS", summary?.assignments ?: 0, Modifier.weight(1f))
                    MetricCard("CONCERNS", summary?.concerns ?: 0, Modifier.weight(1f))
                }
                Text("UPCOMING DEADLINES", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                if (upcoming.isEmpty()) Text("No upcoming assignments are currently listed.", color = Muted)
                upcoming.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(item.course?.code, item.dueAt).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                        }
                    }
                }
            } else if (selected == "Courses") {
                Text("COURSE REGISTER", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && courses.isEmpty()) Text("No courses have been added yet.", color = Muted)
                courses.forEach { course ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(course.code, color = Cyan, fontWeight = FontWeight.Bold)
                            Text(course.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(course.lecturer, course.semester).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                        }
                    }
                }
            } else if (selected == "Tasks") {
                Text("ASSIGNMENTS / DEADLINES", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && assignments.isEmpty()) Text("No assignments have been recorded.", color = Muted)
                assignments.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(item.course?.code, item.dueAt, item.status).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                        }
                    }
                }
            } else {
                AvaVoiceScreen(api)
            }
        }
    }
}

@Composable
private fun MetricCard(label: String, value: Int, modifier: Modifier = Modifier) {
    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = modifier) {
        Column(Modifier.padding(16.dp)) {
            Text(label, color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
            Text(value.toString(), color = Cyan, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        }
    }
}
