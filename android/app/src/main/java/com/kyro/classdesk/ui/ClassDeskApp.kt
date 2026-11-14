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
import com.google.gson.Gson
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
        val secureStore = ApiClient.cookies(context)
        fun restoreOfflineSnapshot() {
            user = secureStore.loadUser()
            summary = secureStore.loadSnapshot("summary")?.let { runCatching { Gson().fromJson(it, SummaryDto::class.java) }.getOrNull() }
            upcoming = secureStore.loadSnapshot("upcoming")?.let { runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
            if (user != null) error = "OFFLINE MODE / Showing the last securely saved overview. Changes are paused until reconnection."
        }
        try {
            val response = api.session()
            if (response.isSuccessful) {
                user = response.body()?.user
                if (user != null) {
                    secureStore.saveUser(user!!)
                    ClassDeskSyncScheduler.schedule(context)
                    val data = api.summary()
                    if (data.isSuccessful) {
                        summary = data.body()?.summary
                        upcoming = data.body()?.upcomingAssignments.orEmpty()
                        summary?.let { secureStore.saveSnapshot("summary", Gson().toJson(it)) }
                        secureStore.saveSnapshot("upcoming", Gson().toJson(upcoming))
                    } else {
                        summary = secureStore.loadSnapshot("summary")?.let { runCatching { Gson().fromJson(it, SummaryDto::class.java) }.getOrNull() }
                        upcoming = secureStore.loadSnapshot("upcoming")?.let { runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                    }
                }
            } else if (response.code() == 401) {
                secureStore.clear()
                user = null
            } else restoreOfflineSnapshot()
        } catch (_: Exception) {
            restoreOfflineSnapshot()
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
    var lectures by remember { mutableStateOf<List<LectureDto>>(emptyList()) }
    var attendance by remember { mutableStateOf<List<AttendanceDto>>(emptyList()) }
    var concerns by remember { mutableStateOf<List<ConcernDto>>(emptyList()) }
    var moduleLoading by remember { mutableStateOf(false) }
    var moduleError by remember { mutableStateOf<String?>(null) }
    var showCourseDialog by remember { mutableStateOf(false) }
    var showAssignmentDialog by remember { mutableStateOf(false) }
    var courseCode by remember { mutableStateOf("") }
    var courseName by remember { mutableStateOf("") }
    var lecturer by remember { mutableStateOf("") }
    var semester by remember { mutableStateOf("") }
    var assignmentTitle by remember { mutableStateOf("") }
    var assignmentDetails by remember { mutableStateOf("") }
    var assignmentDueAt by remember { mutableStateOf("") }
    var showLectureDialog by remember { mutableStateOf(false) }
    var lectureTopic by remember { mutableStateOf("") }
    var lectureSummary by remember { mutableStateOf("") }
    var lectureDate by remember { mutableStateOf("") }
    var lectureVenue by remember { mutableStateOf("") }
    var showAttendanceDialog by remember { mutableStateOf(false) }
    var attendanceDate by remember { mutableStateOf("") }
    var attendancePresent by remember { mutableStateOf("") }
    var attendanceAbsent by remember { mutableStateOf("") }
    var showConcernDialog by remember { mutableStateOf(false) }
    var concernTitle by remember { mutableStateOf("") }
    var concernDetails by remember { mutableStateOf("") }
    var concernCategory by remember { mutableStateOf("GENERAL") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val secureStore = remember { ApiClient.cookies(context) }
    LaunchedEffect(selected) {
        moduleError = null
        if (selected in listOf("Courses", "Tasks", "Lectures", "Attendance", "Concerns")) {
            moduleLoading = true
            try {
                if (selected == "Courses") {
                    val response = api.courses()
                    if (response.isSuccessful) {
                        courses = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("courses", Gson().toJson(courses))
                    } else {
                        courses = secureStore.loadSnapshot("courses")?.let { runCatching { Gson().fromJson(it, Array<CourseDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh courses; showing the last saved copy."
                    }
                } else if (selected == "Tasks") {
                    val response = api.assignments()
                    if (response.isSuccessful) {
                        assignments = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("assignments", Gson().toJson(assignments))
                    } else {
                        assignments = secureStore.loadSnapshot("assignments")?.let { runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh assignments; showing the last saved copy."
                    }
                } else if (selected == "Lectures") {
                    val response = api.lectures()
                    if (response.isSuccessful) {
                        lectures = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("lectures", Gson().toJson(lectures))
                    } else {
                        lectures = secureStore.loadSnapshot("lectures")?.let { runCatching { Gson().fromJson(it, Array<LectureDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh lectures; showing the last saved copy."
                    }
                    if (showLectureDialog) AlertDialog(
                    onDismissRequest = { showLectureDialog = false },
                    title = { Text("Add lecture") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(lectureTopic, { lectureTopic = it }, label = { Text("Topic") }, singleLine = true)
                        OutlinedTextField(lectureSummary, { lectureSummary = it }, label = { Text("Summary") }, minLines = 2)
                        OutlinedTextField(lectureDate, { lectureDate = it }, label = { Text("Held date/time (ISO, optional)") }, singleLine = true)
                        OutlinedTextField(lectureVenue, { lectureVenue = it }, label = { Text("Venue (optional)") }, singleLine = true)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val saved = api.createAcademic(mapOf("resource" to "lectures", "topic" to lectureTopic.trim(), "summary" to lectureSummary.trim(), "heldAt" to lectureDate.trim(), "venue" to lectureVenue.trim()))
                        if (saved.isSuccessful) {
                            lectures = api.lectures().body()?.items.orEmpty()
                            lectureTopic = ""; lectureSummary = ""; lectureDate = ""; lectureVenue = ""
                            showLectureDialog = false
                        } else moduleError = "Lecture could not be saved. Check the date format."
                    } }, enabled = lectureTopic.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showLectureDialog = false }) { Text("CANCEL") } }
                )
            } else if (selected == "Attendance") {
                    val response = api.attendance()
                    if (response.isSuccessful) {
                        attendance = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("attendance", Gson().toJson(attendance))
                    } else {
                        attendance = secureStore.loadSnapshot("attendance")?.let { runCatching { Gson().fromJson(it, Array<AttendanceDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh attendance; showing the last saved copy."
                    }
                } else {
                    val response = api.concerns()
                    if (response.isSuccessful) {
                        concerns = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("concerns", Gson().toJson(concerns))
                    } else {
                        concerns = secureStore.loadSnapshot("concerns")?.let { runCatching { Gson().fromJson(it, Array<ConcernDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh concerns; showing the last saved copy."
                    }
                }
            } catch (_: Exception) {
                if (selected == "Courses") courses = secureStore.loadSnapshot("courses")?.let { runCatching { Gson().fromJson(it, Array<CourseDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Tasks") assignments = secureStore.loadSnapshot("assignments")?.let { runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Lectures") lectures = secureStore.loadSnapshot("lectures")?.let { runCatching { Gson().fromJson(it, Array<LectureDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Attendance") attendance = secureStore.loadSnapshot("attendance")?.let { runCatching { Gson().fromJson(it, Array<AttendanceDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Concerns") concerns = secureStore.loadSnapshot("concerns")?.let { runCatching { Gson().fromJson(it, Array<ConcernDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                moduleError = "OFFLINE / Showing the last saved copy where available."
            }
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
                listOf("Overview", "Courses", "Tasks", "More", "Ava").forEach { item ->
                    NavigationBarItem(selected = selected == item || (item == "More" && selected in listOf("Lectures", "Attendance", "Concerns")), onClick = { selected = item },
                        icon = { Icon(when (item) {
                            "Courses" -> Icons.Default.MenuBook
                            "Tasks" -> Icons.Default.CheckCircle
                            "More" -> Icons.Default.MoreHoriz
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
                Button(onClick = { showCourseDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD COURSE") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && courses.isEmpty()) Text("No courses have been added yet.", color = Muted)
                courses.forEach { course ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(course.code, color = Cyan, fontWeight = FontWeight.Bold)
                            Text(course.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(course.lecturer, course.semester).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = api.deleteAcademic("courses", course.id)
                                    if (deleted.isSuccessful) courses = api.courses().body()?.items.orEmpty()
                                    else moduleError = "Could not delete this course (${deleted.code()})."
                                }
                            }) { Text("DELETE COURSE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showCourseDialog) AlertDialog(
                    onDismissRequest = { showCourseDialog = false },
                    title = { Text("Add course") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(courseCode, { courseCode = it }, label = { Text("Course code") }, singleLine = true)
                            OutlinedTextField(courseName, { courseName = it }, label = { Text("Course name") }, singleLine = true)
                            OutlinedTextField(lecturer, { lecturer = it }, label = { Text("Lecturer (optional)") }, singleLine = true)
                            OutlinedTextField(semester, { semester = it }, label = { Text("Semester (optional)") }, singleLine = true)
                        }
                    },
                    confirmButton = { TextButton(onClick = {
                        scope.launch {
                            val saved = api.createAcademic(mapOf("resource" to "courses", "code" to courseCode.trim(), "name" to courseName.trim(), "lecturer" to lecturer.trim(), "semester" to semester.trim()))
                            if (saved.isSuccessful) {
                                courses = api.courses().body()?.items.orEmpty()
                                courseCode = ""; courseName = ""; lecturer = ""; semester = ""
                                showCourseDialog = false
                            } else moduleError = "Course could not be saved (${saved.code()})."
                        }
                    }, enabled = courseCode.isNotBlank() && courseName.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showCourseDialog = false }) { Text("CANCEL") } }
                )
            } else if (selected == "Tasks") {
                Text("ASSIGNMENTS / DEADLINES", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showAssignmentDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD ASSIGNMENT") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && assignments.isEmpty()) Text("No assignments have been recorded.", color = Muted)
                assignments.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(item.course?.code, item.dueAt, item.status).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = {
                                    scope.launch {
                                        val next = if (item.status == "DONE") "TODO" else "DONE"
                                        val saved = api.updateAcademic(mapOf("resource" to "assignments", "id" to item.id, "status" to next))
                                        if (saved.isSuccessful) assignments = api.assignments().body()?.items.orEmpty()
                                        else moduleError = "Assignment status could not be updated (${saved.code()})."
                                    }
                                }) { Text(if (item.status == "DONE") "REOPEN" else "MARK DONE", color = Cyan, fontSize = 10.sp) }
                                if (user.role == "CLASS_REP") TextButton(onClick = {
                                    scope.launch {
                                        val deleted = api.deleteAcademic("assignments", item.id)
                                        if (deleted.isSuccessful) assignments = api.assignments().body()?.items.orEmpty()
                                        else moduleError = "Assignment could not be deleted (${deleted.code()})."
                                    }
                                }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                            }
                        }
                    }
                }
                if (showAssignmentDialog) AlertDialog(
                    onDismissRequest = { showAssignmentDialog = false },
                    title = { Text("Add assignment") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(assignmentTitle, { assignmentTitle = it }, label = { Text("Assignment title") }, singleLine = true)
                            OutlinedTextField(assignmentDetails, { assignmentDetails = it }, label = { Text("Details") }, minLines = 2)
                            OutlinedTextField(assignmentDueAt, { assignmentDueAt = it }, label = { Text("Due date (ISO date/time, optional)") }, singleLine = true)
                        }
                    },
                    confirmButton = { TextButton(onClick = {
                        scope.launch {
                            val saved = api.createAcademic(mapOf("resource" to "assignments", "title" to assignmentTitle.trim(), "details" to assignmentDetails.trim(), "dueAt" to assignmentDueAt.trim()))
                            if (saved.isSuccessful) {
                                assignments = api.assignments().body()?.items.orEmpty()
                                assignmentTitle = ""; assignmentDetails = ""; assignmentDueAt = ""
                                showAssignmentDialog = false
                            } else moduleError = "Assignment could not be saved (${saved.code()}). Check the due date format."
                        }
                    }, enabled = assignmentTitle.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showAssignmentDialog = false }) { Text("CANCEL") } }
                )
            } else if (selected == "More") {
                Text("CLASS OPERATIONS", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                listOf("Lectures", "Attendance", "Concerns").forEach { module ->
                    OutlinedButton(onClick = { selected = module }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
                        Text(module.uppercase(), color = Cyan, modifier = Modifier.fillMaxWidth())
                    }
                }
                Text("More modules will be added here as their native workflows are completed.", color = Muted, fontSize = 12.sp)
            } else if (selected == "Lectures") {
                Text("LECTURE REGISTER", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showLectureDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD LECTURE") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && lectures.isEmpty()) Text("No lectures have been recorded.", color = Muted)
                lectures.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.topic, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(listOfNotNull(item.course?.code, item.heldAt ?: item.scheduledAt, item.venue).joinToString("  /  "), color = Muted, fontSize = 12.sp)
                            if (item.summary.orEmpty().isNotBlank()) Text(item.summary.orEmpty(), color = Muted, fontSize = 12.sp)
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = api.deleteAcademic("lectures", item.id)
                                    if (deleted.isSuccessful) lectures = api.lectures().body()?.items.orEmpty()
                                    else moduleError = "Could not delete lecture (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
            } else if (selected == "Attendance") {
                Text("ATTENDANCE SUMMARIES", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showAttendanceDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD SUMMARY") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && attendance.isEmpty()) Text("No attendance summaries have been recorded.", color = Muted)
                attendance.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.course?.code ?: "CLASS SESSION", color = Cyan, fontWeight = FontWeight.Bold)
                            Text(item.sessionDate, color = Color.White)
                            Text("PRESENT  ${item.presentCount}     ABSENT  ${item.absentCount}", color = Muted, fontSize = 12.sp)
                            item.note?.let { Text(it, color = Muted, fontSize = 12.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = api.deleteAcademic("attendance", item.id)
                                    if (deleted.isSuccessful) attendance = api.attendance().body()?.items.orEmpty()
                                    else moduleError = "Could not delete attendance summary (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showAttendanceDialog) AlertDialog(
                    onDismissRequest = { showAttendanceDialog = false },
                    title = { Text("Add attendance summary") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(attendanceDate, { attendanceDate = it }, label = { Text("Session date (YYYY-MM-DD)") }, singleLine = true)
                        OutlinedTextField(attendancePresent, { attendancePresent = it }, label = { Text("Present count") }, singleLine = true)
                        OutlinedTextField(attendanceAbsent, { attendanceAbsent = it }, label = { Text("Absent count") }, singleLine = true)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val saved = api.createAcademic(mapOf("resource" to "attendance", "sessionDate" to attendanceDate.trim(), "presentCount" to attendancePresent.trim(), "absentCount" to attendanceAbsent.trim()))
                        if (saved.isSuccessful) {
                            attendance = api.attendance().body()?.items.orEmpty()
                            attendanceDate = ""; attendancePresent = ""; attendanceAbsent = ""
                            showAttendanceDialog = false
                        } else moduleError = "Attendance could not be saved. Check date and whole-number counts."
                    } }, enabled = attendanceDate.isNotBlank() && attendancePresent.toIntOrNull() != null && attendanceAbsent.toIntOrNull() != null) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showAttendanceDialog = false }) { Text("CANCEL") } }
                )
            } else if (selected == "Concerns") {
                Text("CLASS CONCERNS", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showConcernDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD CONCERN") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && concerns.isEmpty()) Text("No class concerns have been recorded.", color = Muted)
                concerns.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Text(item.category.uppercase() + " / " + item.status.uppercase(), color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(item.details, color = Muted, fontSize = 12.sp)
                            item.resolution?.let { Text("RESOLUTION: $it", color = Gold, fontSize = 12.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = api.deleteAcademic("concerns", item.id)
                                    if (deleted.isSuccessful) concerns = api.concerns().body()?.items.orEmpty()
                                    else moduleError = "Could not delete concern (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showConcernDialog) AlertDialog(
                    onDismissRequest = { showConcernDialog = false },
                    title = { Text("Add class concern") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(concernCategory, { concernCategory = it }, label = { Text("Category") }, singleLine = true)
                        OutlinedTextField(concernTitle, { concernTitle = it }, label = { Text("Title") }, singleLine = true)
                        OutlinedTextField(concernDetails, { concernDetails = it }, label = { Text("Details") }, minLines = 3)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val saved = api.createAcademic(mapOf("resource" to "concerns", "category" to concernCategory.trim(), "title" to concernTitle.trim(), "details" to concernDetails.trim()))
                        if (saved.isSuccessful) {
                            concerns = api.concerns().body()?.items.orEmpty()
                            concernCategory = "GENERAL"; concernTitle = ""; concernDetails = ""
                            showConcernDialog = false
                        } else moduleError = "Concern could not be saved."
                    } }, enabled = concernTitle.isNotBlank() && concernDetails.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showConcernDialog = false }) { Text("CANCEL") } }
                )
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
