package com.kyro.classdesk.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import kotlinx.coroutines.delay

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import java.util.UUID
import java.time.Instant
import com.google.gson.JsonObject

private val Canvas = Color(0xFF0A1019)
private val Panel = Color(0xFF111B28)
private val Cyan = Color(0xFF42D9F5)
private val Muted = Color(0xFF91A4B8)
private val Gold = Color(0xFFF2C94C)

@Composable
fun ClassDeskApp(initialDestination: String? = null) {
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
                ClassDeskSyncScheduler.cancel(context)
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
            initialDestination = initialDestination,
            user = user!!,
            api = api,
            summary = summary,
            upcoming = upcoming,
            onRefresh = { scope.launch { loading = true; refreshSession() } },
            onLogout = {
                ClassDeskSyncScheduler.cancel(context)
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
private fun DashboardScreen(initialDestination: String?, user: UserDto, api: ClassDeskApi, summary: SummaryDto?, upcoming: List<AssignmentDto>, onRefresh: () -> Unit, onLogout: () -> Unit) {
    var selected by remember(initialDestination) { mutableStateOf(initialDestination ?: "Overview") }
    var courses by remember { mutableStateOf<List<CourseDto>>(emptyList()) }
    var assignments by remember { mutableStateOf<List<AssignmentDto>>(emptyList()) }
    var lectures by remember { mutableStateOf<List<LectureDto>>(emptyList()) }
    var attendance by remember { mutableStateOf<List<AttendanceDto>>(emptyList()) }
    var concerns by remember { mutableStateOf<List<ConcernDto>>(emptyList()) }
    var announcements by remember { mutableStateOf<List<AnnouncementDto>>(emptyList()) }
    var calendarItems by remember { mutableStateOf<List<AcademicRecordDto>>(emptyList()) }
    var showCalendarDialog by remember { mutableStateOf(false) }
    var calendarTitle by remember { mutableStateOf("") }
    var calendarContent by remember { mutableStateOf("") }
    var calendarDate by remember { mutableStateOf("") }
    var calendarType by remember { mutableStateOf("TIMETABLE") }
    var editingCalendarId by remember { mutableStateOf<String?>(null) }
    var showAnnouncementDialog by remember { mutableStateOf(false) }
    var announcementTitle by remember { mutableStateOf("") }
    var announcementBody by remember { mutableStateOf("") }
    var announcementCategory by remember { mutableStateOf("GENERAL") }
    var showAnnouncementEditDialog by remember { mutableStateOf(false) }
    var editingAnnouncementId by remember { mutableStateOf<String?>(null) }
    var editingAnnouncementTitle by remember { mutableStateOf("") }
    var editingAnnouncementBody by remember { mutableStateOf("") }
    var editingAnnouncementCategory by remember { mutableStateOf("GENERAL") }
    var deleteAnnouncementTarget by remember { mutableStateOf<AnnouncementDto?>(null) }
    var moduleLoading by remember { mutableStateOf(false) }
    var moduleError by remember { mutableStateOf<String?>(null) }
    var showCourseDialog by remember { mutableStateOf(false) }
    var showAssignmentDialog by remember { mutableStateOf(false) }
    var editingCourseId by remember { mutableStateOf<String?>(null) }
    var courseCode by remember { mutableStateOf("") }
    var courseName by remember { mutableStateOf("") }
    var lecturer by remember { mutableStateOf("") }
    var semester by remember { mutableStateOf("") }
    var editingAssignmentId by remember { mutableStateOf<String?>(null) }
    var assignmentCourseId by remember { mutableStateOf<String?>(null) }
    var assignmentTitle by remember { mutableStateOf("") }
    var assignmentDetails by remember { mutableStateOf("") }
    var assignmentDueAt by remember { mutableStateOf("") }
    var showLectureDialog by remember { mutableStateOf(false) }
    var editingLectureId by remember { mutableStateOf<String?>(null) }
    var lectureCourseId by remember { mutableStateOf<String?>(null) }
    var lectureTopic by remember { mutableStateOf("") }
    var lectureSummary by remember { mutableStateOf("") }
    var lectureScheduledDate by remember { mutableStateOf("") }
    var lectureDate by remember { mutableStateOf("") }
    var lectureVenue by remember { mutableStateOf("") }
    var showAttendanceDialog by remember { mutableStateOf(false) }
    var editingAttendanceId by remember { mutableStateOf<String?>(null) }
    var attendanceCourseId by remember { mutableStateOf<String?>(null) }
    var attendanceDate by remember { mutableStateOf("") }
    var attendancePresent by remember { mutableStateOf("") }
    var attendanceAbsent by remember { mutableStateOf("") }
    var attendanceNote by remember { mutableStateOf("") }
    var showConcernDialog by remember { mutableStateOf(false) }
    var editingConcernId by remember { mutableStateOf<String?>(null) }
    var concernTitle by remember { mutableStateOf("") }
    var concernDetails by remember { mutableStateOf("") }
    var concernResolution by remember { mutableStateOf("") }
    var concernCategory by remember { mutableStateOf("GENERAL") }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val secureStore = remember { ApiClient.cookies(context) }

    suspend fun mutateAcademic(resource: String, method: String, payload: Map<String, String>): OfflineMutationResult {
        val result = saveAcademicMutation(context, user, api, resource, method, payload)
        if (result.queued) moduleError = result.message ?: "Saved locally; waiting for synchronization."
        return result
    }

    suspend fun mutateAnnouncement(method: String, payload: Map<String, String>): OfflineMutationResult {
        val result = saveAnnouncementMutation(context, user, api, method, payload)
        if (result.queued) moduleError = result.message ?: "Saved locally; waiting for synchronization."
        return result
    }
    val connectivity = remember { ClassDeskConnectivity(context) }
    var online by remember { mutableStateOf(connectivity.isOnline()) }
    val currentOnline = rememberUpdatedState(online)
    var connectionToast by remember { mutableStateOf<String?>(null) }
    var notificationPermissionNeeded by remember {
        mutableStateOf(Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
    }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationPermissionNeeded = !granted
    }
    DisposableEffect(connectivity) {
        val callback = connectivity.register { connected ->
            if (currentOnline.value != connected) {
                online = connected
                connectionToast = if (connected) "You're back online. ClassDesk is reconnecting."
                    else "Offline mode. ClassDesk will reconnect when your internet returns."
            }
        }
        onDispose { connectivity.unregister(callback) }
    }
    LaunchedEffect(Unit) {
        if (!online) connectionToast = "Offline mode. Your saved data remains available."
    }
    LaunchedEffect(connectionToast) {
        if (connectionToast != null) {
            delay(3000)
            connectionToast = null
        }
    }
    LaunchedEffect(selected) {
        moduleError = null
        if (selected in listOf("Courses", "Tasks", "Lectures", "Attendance", "Concerns", "Announcements", "Calendar")) {
            moduleLoading = true
            try {
                if (selected in listOf("Tasks", "Lectures", "Attendance")) {
                    val courseResponse = api.courses()
                    if (courseResponse.isSuccessful) {
                        courses = courseResponse.body()?.items.orEmpty()
                        secureStore.saveSnapshot("courses", Gson().toJson(courses))
                    } else {
                        courses = secureStore.loadSnapshot("courses")?.let { runCatching { Gson().fromJson(it, Array<CourseDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                    }
                }
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

            } else if (selected == "Attendance") {
                    val response = api.attendance()
                    if (response.isSuccessful) {
                        attendance = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("attendance", Gson().toJson(attendance))
                    } else {
                        attendance = secureStore.loadSnapshot("attendance")?.let { runCatching { Gson().fromJson(it, Array<AttendanceDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh attendance; showing the last saved copy."
                    }
                } else if (selected == "Concerns") {
                    val response = api.concerns()
                    if (response.isSuccessful) {
                        concerns = response.body()?.items.orEmpty()
                        secureStore.saveSnapshot("concerns", Gson().toJson(concerns))
                    } else {
                        concerns = secureStore.loadSnapshot("concerns")?.let { runCatching { Gson().fromJson(it, Array<ConcernDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh concerns; showing the last saved copy."
                    }
                } else if (selected == "Calendar") {
                    val response = api.records()
                    if (response.isSuccessful) {
                        calendarItems = response.body()?.records.orEmpty()
                        secureStore.saveSnapshot("calendar", Gson().toJson(calendarItems))
                    } else {
                        calendarItems = secureStore.loadSnapshot("calendar")?.let { runCatching { Gson().fromJson(it, Array<AcademicRecordDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh the calendar; showing the last saved copy."
                    }
                } else {
                    val response = api.announcements()
                    if (response.isSuccessful) {
                        val fetchedAnnouncements = response.body()?.announcements.orEmpty()
                        val previousAnnouncements = secureStore.loadSnapshot("announcements")?.let {
                            runCatching { Gson().fromJson(it, Array<AnnouncementDto>::class.java)?.toList() }.getOrNull()
                        }
                        if (previousAnnouncements != null && ClassDeskNotifications.canPost(context)) {
                            val previousById = previousAnnouncements.associateBy { it.id }
                            fetchedAnnouncements.filter { it.status.equals("PUBLISHED", true) && previousById[it.id]?.status?.equals("PUBLISHED", true) != true }
                                .forEach { ClassDeskNotifications.announcement(context, it.id, it.title) }
                        }
                        announcements = fetchedAnnouncements
                        secureStore.saveSnapshot("announcements", Gson().toJson(announcements))
                    } else {
                        announcements = secureStore.loadSnapshot("announcements")?.let { runCatching { Gson().fromJson(it, Array<AnnouncementDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                        moduleError = "Could not refresh announcements; showing the last saved copy."
                    }
                }
            } catch (_: Exception) {
                if (selected == "Courses") courses = secureStore.loadSnapshot("courses")?.let { runCatching { Gson().fromJson(it, Array<CourseDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Tasks") assignments = secureStore.loadSnapshot("assignments")?.let { runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Lectures") lectures = secureStore.loadSnapshot("lectures")?.let { runCatching { Gson().fromJson(it, Array<LectureDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Attendance") attendance = secureStore.loadSnapshot("attendance")?.let { runCatching { Gson().fromJson(it, Array<AttendanceDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Concerns") concerns = secureStore.loadSnapshot("concerns")?.let { runCatching { Gson().fromJson(it, Array<ConcernDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Announcements") announcements = secureStore.loadSnapshot("announcements")?.let { runCatching { Gson().fromJson(it, Array<AnnouncementDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                if (selected == "Calendar") calendarItems = secureStore.loadSnapshot("calendar")?.let { runCatching { Gson().fromJson(it, Array<AcademicRecordDto>::class.java)?.toList() }.getOrNull() }.orEmpty()
                moduleError = "OFFLINE / Showing the last saved copy where available."
            }
            finally { moduleLoading = false }
        }
    }
    Scaffold(
        containerColor = Canvas,
        topBar = {
            Column(Modifier.fillMaxWidth().background(Panel)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("AFIT CLASSDESK", color = Cyan, fontSize = 11.sp, letterSpacing = 1.8.sp, fontWeight = FontWeight.Bold)
                        Text("COMMAND / ${user.role.replace('_', ' ')}", color = Muted, fontSize = 10.sp)
                    }
                    IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh", tint = Cyan) }
                    IconButton(onClick = onLogout) { Icon(Icons.Default.Logout, "Sign out", tint = Gold) }
                }
                AnimatedVisibility(visible = connectionToast != null, enter = fadeIn(), exit = fadeOut()) {
                    Surface(color = Color(0xFF1B2A39), modifier = Modifier.fillMaxWidth()) {
                        Text(connectionToast.orEmpty(), color = Color.White, fontSize = 12.sp,
                            modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp))
                    }
                }
                if (notificationPermissionNeeded) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Enable class notifications", color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                        TextButton(onClick = { notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }) {
                            Text("ENABLE", color = Cyan, fontSize = 10.sp)
                        }
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Panel, contentColor = Cyan) {
                listOf("Overview", "Courses", "Tasks", "More", "Ava").forEach { item ->
                    NavigationBarItem(selected = selected == item || (item == "More" && selected in listOf("Lectures", "Attendance", "Concerns", "Announcements", "Calendar", "Documents", "Ava Tasks", "Ava Tools", "Sync Queue", "Catch-up Centre", "Coverage", "Class Records", "Settings", "Backup & Export")), onClick = { selected = item },
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
                            TextButton(onClick = {
                                editingCourseId = course.id
                                courseCode = course.code; courseName = course.name
                                lecturer = course.lecturer.orEmpty(); semester = course.semester.orEmpty()
                                showCourseDialog = true
                            }) { Text("EDIT COURSE", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val changed = mutateAcademic("courses", "PATCH", mapOf("id" to course.id, "active" to (!course.active).toString()))
                                    if (changed.isSuccessful) {
                                        if (!changed.queued) courses = api.courses().body()?.items.orEmpty()
                                        else courses = courses.map { if (it.id == course.id) it.copy(active = !course.active) else it }
                                    } else moduleError = "Course status could not be changed."
                                }
                            }) { Text(if (course.active) "DEACTIVATE" else "ACTIVATE", color = Gold, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = mutateAcademic("courses", "DELETE", mapOf("id" to course.id))
                                    if (deleted.isSuccessful) { if (deleted.queued) courses = courses.filterNot { it.id == course.id } else courses = api.courses().body()?.items.orEmpty() }
                                    else moduleError = "Could not delete this course (${deleted.code()})."
                                }
                            }) { Text("DELETE COURSE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showCourseDialog) AlertDialog(
                    onDismissRequest = { showCourseDialog = false },
                    title = { Text(if (editingCourseId == null) "Add course" else "Edit course") },
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
                            val id = editingCourseId
                            val payload = mapOf("code" to courseCode.trim(), "name" to courseName.trim(), "lecturer" to lecturer.trim(), "semester" to semester.trim())
                            val saved = mutateAcademic("courses", if (id == null) "POST" else "PATCH", if (id == null) payload else payload + mapOf("id" to id))
                            if (saved.isSuccessful) {
                                if (saved.queued && id != null) courses = courses.map { if (it.id == id) it.copy(code = courseCode.trim(), name = courseName.trim(), lecturer = lecturer.trim(), semester = semester.trim()) else it }
                                if (!saved.queued) courses = api.courses().body()?.items.orEmpty()
                                editingCourseId = null
                                courseCode = ""; courseName = ""; lecturer = ""; semester = ""
                                showCourseDialog = false
                            } else moduleError = saved.message ?: "Course could not be saved (${saved.code()})."
                        }
                    }, enabled = courseCode.isNotBlank() && courseName.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showCourseDialog = false; editingCourseId = null }) { Text("CANCEL") } }
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
                                    editingAssignmentId = item.id
                                    assignmentCourseId = item.course?.id; assignmentTitle = item.title; assignmentDetails = item.details.orEmpty(); assignmentDueAt = item.dueAt.orEmpty()
                                    showAssignmentDialog = true
                                }) { Text("EDIT", color = Cyan, fontSize = 10.sp) }
                                TextButton(onClick = {
                                    scope.launch {
                                        val next = when (item.status) {
                                            "TODO" -> "IN_PROGRESS"
                                            "IN_PROGRESS" -> "DONE"
                                            else -> "TODO"
                                        }
                                        val saved = mutateAcademic("assignments", "PATCH", mapOf("id" to item.id, "status" to next))
                                        if (saved.isSuccessful) {
                                            if (saved.queued) assignments = assignments.map { if (it.id == item.id) it.copy(status = next) else it }
                                            else assignments = api.assignments().body()?.items.orEmpty()
                                        } else moduleError = "Assignment status could not be updated (${saved.code()})."
                                    }
                                }) { Text(when (item.status) { "TODO" -> "START"; "IN_PROGRESS" -> "MARK DONE"; else -> "REOPEN" }, color = Cyan, fontSize = 10.sp) }
                                if (user.role == "CLASS_REP") TextButton(onClick = {
                                    scope.launch {
                                        val deleted = mutateAcademic("assignments", "DELETE", mapOf("id" to item.id))
                                        if (deleted.isSuccessful) { if (deleted.queued) assignments = assignments.filterNot { it.id == item.id } else assignments = api.assignments().body()?.items.orEmpty() }
                                        else moduleError = "Assignment could not be deleted (${deleted.code()})."
                                    }
                                }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                            }
                        }
                    }
                }
                if (showAssignmentDialog) AlertDialog(
                    onDismissRequest = { showAssignmentDialog = false },
                    title = { Text(if (editingAssignmentId == null) "Add assignment" else "Edit assignment") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            CoursePicker(courses, assignmentCourseId) { assignmentCourseId = it }
                            OutlinedTextField(assignmentTitle, { assignmentTitle = it }, label = { Text("Assignment title") }, singleLine = true)
                            OutlinedTextField(assignmentDetails, { assignmentDetails = it }, label = { Text("Details") }, minLines = 2)
                            OutlinedTextField(assignmentDueAt, { assignmentDueAt = it }, label = { Text("Due date (ISO date/time, optional)") }, singleLine = true)
                        }
                    },
                    confirmButton = { TextButton(onClick = {
                        scope.launch {
                            val id = editingAssignmentId
                            val payload = mapOf("courseId" to assignmentCourseId.orEmpty(), "title" to assignmentTitle.trim(), "details" to assignmentDetails.trim(), "dueAt" to assignmentDueAt.trim())
                            val saved = mutateAcademic("assignments", if (id == null) "POST" else "PATCH", if (id == null) payload else payload + mapOf("id" to id))
                            if (saved.isSuccessful) {
                                if (saved.queued && id != null) assignments = assignments.map { if (it.id == id) it.copy(title = assignmentTitle.trim(), details = assignmentDetails.trim(), dueAt = assignmentDueAt.trim().ifBlank { null }, course = courses.firstOrNull { course -> course.id == assignmentCourseId }?.let { course -> CourseRef(course.id, course.code, course.name) }) else it }
                                if (!saved.queued) assignments = api.assignments().body()?.items.orEmpty()
                                editingAssignmentId = null
                                assignmentCourseId = null; assignmentTitle = ""; assignmentDetails = ""; assignmentDueAt = ""
                                showAssignmentDialog = false
                            } else moduleError = saved.message ?: "Assignment could not be saved (${saved.code()}). Check the due date format."
                        }
                    }, enabled = assignmentTitle.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showAssignmentDialog = false; editingAssignmentId = null }) { Text("CANCEL") } }
                )
            } else if (selected == "More") {
                Text("CLASS OPERATIONS", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                listOf("Lectures", "Attendance", "Concerns", "Announcements", "Calendar", "Documents", "Sync Queue", "Catch-up Centre", "Coverage", "Class Records", "Settings", "Backup & Export")
                    .filter { it != "Settings" || user.role == "CLASS_REP" }
                    .forEach { module ->
                    OutlinedButton(onClick = { selected = module }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
                        Text(module.uppercase(), color = Cyan, modifier = Modifier.fillMaxWidth())
                    }
                }
                Text("Native academic tools, records, catch-up views and account diagnostics.", color = Muted, fontSize = 12.sp)
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
                            TextButton(onClick = {
                                editingLectureId = item.id
                                lectureCourseId = item.course?.id; lectureTopic = item.topic; lectureSummary = item.summary.orEmpty()
                                lectureScheduledDate = item.scheduledAt.orEmpty(); lectureDate = item.heldAt.orEmpty(); lectureVenue = item.venue.orEmpty()
                                showLectureDialog = true
                            }) { Text("EDIT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = mutateAcademic("lectures", "DELETE", mapOf("id" to item.id))
                                    if (deleted.isSuccessful) { if (deleted.queued) lectures = lectures.filterNot { it.id == item.id } else lectures = api.lectures().body()?.items.orEmpty() }
                                    else moduleError = "Could not delete lecture (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showLectureDialog) AlertDialog(
                    onDismissRequest = { showLectureDialog = false },
                    title = { Text(if (editingLectureId == null) "Add lecture" else "Edit lecture") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CoursePicker(courses, lectureCourseId) { lectureCourseId = it }
                        OutlinedTextField(lectureTopic, { lectureTopic = it }, label = { Text("Topic") }, singleLine = true)
                        OutlinedTextField(lectureSummary, { lectureSummary = it }, label = { Text("Summary") }, minLines = 2)
                        OutlinedTextField(lectureScheduledDate, { lectureScheduledDate = it }, label = { Text("Scheduled date/time (ISO, optional)") }, singleLine = true)
                        OutlinedTextField(lectureDate, { lectureDate = it }, label = { Text("Held date/time (ISO, optional)") }, singleLine = true)
                        OutlinedTextField(lectureVenue, { lectureVenue = it }, label = { Text("Venue (optional)") }, singleLine = true)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val id = editingLectureId
                        val payload = mapOf("courseId" to lectureCourseId.orEmpty(), "topic" to lectureTopic.trim(), "summary" to lectureSummary.trim(), "scheduledAt" to lectureScheduledDate.trim(), "heldAt" to lectureDate.trim(), "venue" to lectureVenue.trim())
                        val saved = mutateAcademic("lectures", if (id == null) "POST" else "PATCH", if (id == null) payload else payload + mapOf("id" to id))
                        if (saved.isSuccessful) {
                            if (saved.queued && id != null) lectures = lectures.map { if (it.id == id) it.copy(topic = lectureTopic.trim(), summary = lectureSummary.trim(), scheduledAt = lectureScheduledDate.trim().ifBlank { null }, heldAt = lectureDate.trim().ifBlank { null }, venue = lectureVenue.trim().ifBlank { null }, course = courses.firstOrNull { course -> course.id == lectureCourseId }?.let { course -> CourseRef(course.id, course.code, course.name) }) else it }
                            if (!saved.queued) lectures = api.lectures().body()?.items.orEmpty()
                            editingLectureId = null
                            lectureCourseId = null; lectureTopic = ""; lectureSummary = ""; lectureScheduledDate = ""; lectureDate = ""; lectureVenue = ""
                            showLectureDialog = false
                        } else moduleError = saved.message ?: "Lecture could not be saved. Check the date format."
                    } }, enabled = lectureTopic.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showLectureDialog = false; editingLectureId = null }) { Text("CANCEL") } }
                )
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
                            TextButton(onClick = {
                                editingAttendanceId = item.id
                                attendanceCourseId = item.course?.id
                                attendanceDate = item.sessionDate.take(10)
                                attendancePresent = item.presentCount.toString()
                                attendanceAbsent = item.absentCount.toString()
                                attendanceNote = item.note.orEmpty()
                                showAttendanceDialog = true
                            }) { Text("EDIT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = mutateAcademic("attendance", "DELETE", mapOf("id" to item.id))
                                    if (deleted.isSuccessful) { if (deleted.queued) attendance = attendance.filterNot { it.id == item.id } else attendance = api.attendance().body()?.items.orEmpty() }
                                    else moduleError = "Could not delete attendance summary (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showAttendanceDialog) AlertDialog(
                    onDismissRequest = { showAttendanceDialog = false },
                    title = { Text(if (editingAttendanceId == null) "Add attendance summary" else "Edit attendance summary") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CoursePicker(courses, attendanceCourseId) { attendanceCourseId = it }
                        OutlinedTextField(attendanceDate, { attendanceDate = it }, label = { Text("Session date (YYYY-MM-DD)") }, singleLine = true)
                        OutlinedTextField(attendancePresent, { attendancePresent = it }, label = { Text("Present count") }, singleLine = true)
                        OutlinedTextField(attendanceAbsent, { attendanceAbsent = it }, label = { Text("Absent count") }, singleLine = true)
                        OutlinedTextField(attendanceNote, { attendanceNote = it }, label = { Text("Note (optional)") }, minLines = 2)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val id = editingAttendanceId
                        val payload = mapOf("courseId" to attendanceCourseId.orEmpty(), "sessionDate" to attendanceDate.trim(), "presentCount" to attendancePresent.trim(), "absentCount" to attendanceAbsent.trim(), "note" to attendanceNote.trim())
                        val saved = mutateAcademic("attendance", if (id == null) "POST" else "PATCH", if (id == null) payload else payload + mapOf("id" to id))
                        if (saved.isSuccessful) {
                            if (saved.queued && id != null) attendance = attendance.map { if (it.id == id) it.copy(sessionDate = attendanceDate.trim(), presentCount = attendancePresent.toInt(), absentCount = attendanceAbsent.toInt(), note = attendanceNote.trim().ifBlank { null }, course = courses.firstOrNull { course -> course.id == attendanceCourseId }?.let { course -> CourseRef(course.id, course.code, course.name) }) else it }
                            if (!saved.queued) attendance = api.attendance().body()?.items.orEmpty()
                            editingAttendanceId = null
                            attendanceCourseId = null; attendanceDate = ""; attendancePresent = ""; attendanceAbsent = ""; attendanceNote = ""
                            showAttendanceDialog = false
                        } else moduleError = saved.message ?: "Attendance could not be saved. Check date and whole-number counts."
                    } }, enabled = attendanceDate.isNotBlank() && attendancePresent.toIntOrNull() != null && attendanceAbsent.toIntOrNull() != null) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showAttendanceDialog = false; editingAttendanceId = null }) { Text("CANCEL") } }
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
                            TextButton(onClick = {
                                editingConcernId = item.id
                                concernCategory = item.category; concernTitle = item.title
                                concernDetails = item.details; concernResolution = item.resolution.orEmpty()
                                showConcernDialog = true
                            }) { Text("EDIT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") {
                                TextButton(onClick = {
                                    scope.launch {
                                        val next = if (item.status == "RESOLVED") "OPEN" else "RESOLVED"
                                        val updated = mutateAcademic("concerns", "PATCH", mapOf("id" to item.id, "status" to next, "resolution" to item.resolution.orEmpty()))
                                        if (updated.isSuccessful) {
                                            if (updated.queued) concerns = concerns.map { if (it.id == item.id) it.copy(status = next) else it }
                                            else concerns = api.concerns().body()?.items.orEmpty()
                                        } else moduleError = "Concern status could not be updated."
                                    }
                                }) { Text(if (item.status == "RESOLVED") "REOPEN" else "RESOLVE", color = Gold, fontSize = 10.sp) }
                                TextButton(onClick = {
                                scope.launch {
                                    val deleted = mutateAcademic("concerns", "DELETE", mapOf("id" to item.id))
                                    if (deleted.isSuccessful) { if (deleted.queued) concerns = concerns.filterNot { it.id == item.id } else concerns = api.concerns().body()?.items.orEmpty() }
                                    else moduleError = "Could not delete concern (${deleted.code()})."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                            }
                        }
                    }
                }
                if (showConcernDialog) AlertDialog(
                    onDismissRequest = { showConcernDialog = false },
                    title = { Text(if (editingConcernId == null) "Add class concern" else "Edit class concern") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(concernCategory, { concernCategory = it }, label = { Text("Category") }, singleLine = true)
                        OutlinedTextField(concernTitle, { concernTitle = it }, label = { Text("Title") }, singleLine = true)
                        OutlinedTextField(concernDetails, { concernDetails = it }, label = { Text("Details") }, minLines = 3)
                        OutlinedTextField(concernResolution, { concernResolution = it }, label = { Text("Resolution (optional)") }, minLines = 2)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val id = editingConcernId
                        val payload = mapOf("category" to concernCategory.trim(), "title" to concernTitle.trim(), "details" to concernDetails.trim(), "resolution" to concernResolution.trim())
                        val saved = mutateAcademic("concerns", if (id == null) "POST" else "PATCH", if (id == null) payload else payload + mapOf("id" to id))
                        if (saved.isSuccessful) {
                            if (saved.queued && id != null) concerns = concerns.map { if (it.id == id) it.copy(category = concernCategory.trim(), title = concernTitle.trim(), details = concernDetails.trim(), resolution = concernResolution.trim().ifBlank { null }) else it }
                            if (!saved.queued) concerns = api.concerns().body()?.items.orEmpty()
                            editingConcernId = null
                            concernCategory = "GENERAL"; concernTitle = ""; concernDetails = ""; concernResolution = ""
                            showConcernDialog = false
                        } else moduleError = saved.message ?: "Concern could not be saved."
                    } }, enabled = concernTitle.isNotBlank() && concernDetails.isNotBlank()) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showConcernDialog = false; editingConcernId = null }) { Text("CANCEL") } }
                )
            } else if (selected == "Calendar") {
                Text("CALENDAR / TIMETABLE", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showCalendarDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ ADD EVENT") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && calendarItems.isEmpty()) Text("No upcoming class events are recorded.", color = Muted)
                calendarItems.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(item.type.uppercase(), color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(item.eventDate.orEmpty(), color = Gold, fontSize = 12.sp)
                            if (item.content.isNotBlank()) Text(item.content, color = Muted, fontSize = 12.sp)
                            TextButton(onClick = {
                                editingCalendarId = item.id
                                calendarType = item.type
                                calendarTitle = item.title
                                calendarContent = item.content
                                calendarDate = item.eventDate.orEmpty().take(10)
                                showCalendarDialog = true
                            }) { Text("EDIT EVENT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = {
                                scope.launch {
                                    val deleted = try { api.deleteRecord(item.id) } catch (_: Exception) { null }
                                    if (deleted == null) {
                                        val store = OfflineStore(context)
                                        try {
                                            store.enqueue(PendingMutation(UUID.randomUUID().toString(), user.username, item.id, "delete", item.version, "{}"))
                                            calendarItems = calendarItems.filterNot { it.id == item.id }
                                            secureStore.saveSnapshot("calendar", Gson().toJson(calendarItems))
                                            moduleError = "Deletion saved on this device and queued for synchronization."
                                        } catch (e: Exception) {
                                            moduleError = e.message ?: "Could not save this deletion to the offline queue."
                                        } finally { store.closeStore() }
                                    } else if (deleted.isSuccessful) {
                                        calendarItems = calendarItems.filterNot { it.id == item.id }
                                        secureStore.saveSnapshot("calendar", Gson().toJson(calendarItems))
                                        try { val refreshed = api.records(); if (refreshed.isSuccessful) calendarItems = refreshed.body()?.records.orEmpty() } catch (_: Exception) { /* local view already reflects the successful delete */ }
                                    } else moduleError = "Could not delete this calendar item."
                                }
                            }) { Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp) }
                        }
                    }
                }
                if (showCalendarDialog) AlertDialog(
                    onDismissRequest = { showCalendarDialog = false },
                    title = { Text(if (editingCalendarId == null) "Add timetable event" else "Edit timetable event") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(calendarType, { calendarType = it.uppercase() }, label = { Text("Type: TIMETABLE or CALENDAR") }, singleLine = true)
                        OutlinedTextField(calendarTitle, { calendarTitle = it }, label = { Text("Event title") }, singleLine = true)
                        OutlinedTextField(calendarDate, { calendarDate = it }, label = { Text("Date/time (ISO format)") }, singleLine = true)
                        OutlinedTextField(calendarContent, { calendarContent = it }, label = { Text("Details / venue") }, minLines = 2)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val normalizedDate = normalizeCalendarDate(calendarDate)
                        if (normalizedDate == null) {
                            moduleError = "Enter a valid date such as YYYY-MM-DD or an ISO date/time."
                            return@launch
                        }
                        val existing = editingCalendarId?.let { id -> calendarItems.firstOrNull { it.id == id } }
                        val id = editingCalendarId
                        val localId = id ?: UUID.randomUUID().toString()
                        val payloadMap = mapOf("id" to localId, "type" to calendarType, "title" to calendarTitle.trim(), "content" to calendarContent.trim(), "eventDate" to normalizedDate)
                        val saved = try {
                            if (id == null) api.createRecord(payloadMap) else api.updateRecord(payloadMap)
                        } catch (_: Exception) { null }
                        if (saved == null) {
                            val payload = JsonObject().apply {
                                addProperty("type", calendarType)
                                addProperty("title", calendarTitle.trim())
                                addProperty("content", calendarContent.trim())
                                addProperty("eventDate", normalizedDate)
                                add("metadata", JsonObject())
                                addProperty("status", existing?.status ?: "ACTIVE")
                                addProperty("updatedAt", Instant.now().toString())
                            }
                            val store = OfflineStore(context)
                            try {
                                store.enqueue(PendingMutation(UUID.randomUUID().toString(), user.username, localId, "upsert", existing?.version ?: 0, Gson().toJson(payload)))
                                val updated = AcademicRecordDto(localId, calendarType, calendarTitle.trim(), calendarContent.trim(), normalizedDate, existing?.status ?: "ACTIVE", (existing?.version ?: 0) + 1)
                                calendarItems = if (id == null) listOf(updated) + calendarItems else calendarItems.map { if (it.id == id) updated else it }
                                secureStore.saveSnapshot("calendar", Gson().toJson(calendarItems))
                                moduleError = "Saved on this device. It will sync when the network returns."
                                editingCalendarId = null
                                calendarTitle = ""; calendarContent = ""; calendarDate = ""; calendarType = "TIMETABLE"
                                showCalendarDialog = false
                            } catch (e: Exception) {
                                moduleError = e.message ?: "Could not save this event to the offline queue."
                            } finally { store.closeStore() }
                        } else if (saved.isSuccessful) {
                            try { val refreshed = api.records(); if (refreshed.isSuccessful) calendarItems = refreshed.body()?.records.orEmpty() } catch (_: Exception) { /* retain the current local view */ }
                            secureStore.saveSnapshot("calendar", Gson().toJson(calendarItems))
                            editingCalendarId = null
                            calendarTitle = ""; calendarContent = ""; calendarDate = ""; calendarType = "TIMETABLE"
                            showCalendarDialog = false
                        } else moduleError = "Event could not be saved. Use TIMETABLE or CALENDAR and a valid ISO date."
                    } }, enabled = calendarTitle.isNotBlank() && calendarDate.isNotBlank() && calendarType in listOf("TIMETABLE", "CALENDAR")) { Text("SAVE") } },
                    dismissButton = { TextButton(onClick = { showCalendarDialog = false; editingCalendarId = null }) { Text("CANCEL") } }
                )
            } else if (selected == "Ava Tasks") {
                AvaTasksScreen(api)
            } else if (selected == "Ava Tools") {
                AvaToolsScreen(api, user.role == "CLASS_REP")
            } else if (selected == "Sync Queue") {
                OfflineQueueScreen(user)
            } else if (selected == "Documents") {
                DocumentLibraryScreen(api, user.role == "CLASS_REP")
            } else if (selected in listOf("Catch-up Centre", "Coverage", "Class Records", "Settings")) {
                NativeParityScreen(selected, api, user)
            } else if (selected == "Backup & Export") {
                BackupToolsScreen(api, user.role == "CLASS_REP")
            } else if (selected == "Announcements") {
                Text("ANNOUNCEMENT STUDIO", color = Gold, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
                Button(onClick = { showAnnouncementDialog = true }, colors = ButtonDefaults.buttonColors(containerColor = Cyan, contentColor = Canvas), shape = RoundedCornerShape(6.dp)) { Text("+ NEW DRAFT") }
                if (moduleLoading) CircularProgressIndicator(color = Cyan)
                moduleError?.let { Text(it, color = Color(0xFFFF7D78)) }
                if (!moduleLoading && announcements.isEmpty()) Text("No announcements have been drafted.", color = Muted)
                announcements.forEach { item ->
                    Surface(color = Panel, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(item.status.uppercase() + " / " + item.category.uppercase(), color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                            Text(item.body, color = Muted, fontSize = 12.sp, maxLines = 5)
                            if (item.status == "DRAFT") TextButton(onClick = {
                                editingAnnouncementId = item.id
                                editingAnnouncementTitle = item.title
                                editingAnnouncementBody = item.body
                                editingAnnouncementCategory = item.category
                                showAnnouncementEditDialog = true
                            }) { Text("EDIT DRAFT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP" && item.status == "DRAFT") TextButton(onClick = {
                                scope.launch {
                                    val approved = mutateAnnouncement("PATCH", mapOf("id" to item.id, "action" to "approve"))
                                    if (approved.isSuccessful) {
                                        val refreshed = api.announcements()
                                        if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                                    } else moduleError = "Announcement approval requires a connection and all placeholders must be resolved."
                                }
                            }) { Text("APPROVE", color = Gold, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP" && item.status == "APPROVED") {
                                TextButton(onClick = {
                                    scope.launch {
                                        val published = mutateAnnouncement("PATCH", mapOf("id" to item.id, "action" to "publish"))
                                        if (published.isSuccessful) {
                                            val refreshed = api.announcements()
                                            if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                                        } else moduleError = "Announcement publication requires a live connection."
                                    }
                                }) { Text("PUBLISH", color = Cyan, fontSize = 10.sp) }
                                TextButton(onClick = {
                                    scope.launch {
                                        val reverted = mutateAnnouncement("PATCH", mapOf("id" to item.id, "action" to "backToDraft"))
                                        if (reverted.isSuccessful) {
                                            val refreshed = api.announcements()
                                            if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                                        } else moduleError = "Could not return this announcement to draft."
                                    }
                                }) { Text("RETURN TO DRAFT", color = Gold, fontSize = 10.sp) }
                            }
                            if (user.role == "CLASS_REP" && item.status == "PUBLISHED") TextButton(onClick = {
                                scope.launch {
                                    val archived = mutateAnnouncement("PATCH", mapOf("id" to item.id, "action" to "archive"))
                                    if (archived.isSuccessful) {
                                        val refreshed = api.announcements()
                                        if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                                    } else moduleError = "Archiving requires a live connection."
                                }
                            }) { Text("ARCHIVE", color = Gold, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP" && item.status == "ARCHIVED") TextButton(onClick = {
                                scope.launch {
                                    val reverted = mutateAnnouncement("PATCH", mapOf("id" to item.id, "action" to "backToDraft"))
                                    if (reverted.isSuccessful) {
                                        val refreshed = api.announcements()
                                        if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                                    } else moduleError = "Could not return this announcement to draft."
                                }
                            }) { Text("RESTORE TO DRAFT", color = Cyan, fontSize = 10.sp) }
                            if (user.role == "CLASS_REP") TextButton(onClick = { deleteAnnouncementTarget = item }) {
                                Text("DELETE", color = Color(0xFFFF7D78), fontSize = 10.sp)
                            }
                        }
                    }
                }
                if (showAnnouncementDialog) AlertDialog(
                    onDismissRequest = { showAnnouncementDialog = false },
                    title = { Text("New announcement draft") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(announcementTitle, { announcementTitle = it }, label = { Text("Title") }, singleLine = true)
                        OutlinedTextField(announcementCategory, { announcementCategory = it }, label = { Text("Category") }, singleLine = true)
                        OutlinedTextField(announcementBody, { announcementBody = it }, label = { Text("Announcement") }, minLines = 4)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val saved = mutateAnnouncement("POST", mapOf("title" to announcementTitle.trim(), "category" to announcementCategory.trim(), "body" to announcementBody.trim()))
                        if (saved.isSuccessful) {
                            if (!saved.queued) {
                                val refreshed = api.announcements()
                                if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                            }
                            announcementTitle = ""; announcementBody = ""; announcementCategory = "GENERAL"
                            showAnnouncementDialog = false
                        } else moduleError = saved.message ?: "Announcement draft could not be saved."
                    } }, enabled = announcementTitle.isNotBlank() && announcementBody.isNotBlank()) { Text("SAVE DRAFT") } },
                    dismissButton = { TextButton(onClick = { showAnnouncementDialog = false }) { Text("CANCEL") } }
                )
                if (showAnnouncementEditDialog) AlertDialog(
                    onDismissRequest = { showAnnouncementEditDialog = false },
                    title = { Text("Edit announcement draft") },
                    text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(editingAnnouncementTitle, { editingAnnouncementTitle = it }, label = { Text("Title") }, singleLine = true)
                        OutlinedTextField(editingAnnouncementCategory, { editingAnnouncementCategory = it }, label = { Text("Category") }, singleLine = true)
                        OutlinedTextField(editingAnnouncementBody, { editingAnnouncementBody = it }, label = { Text("Announcement") }, minLines = 4)
                    } },
                    confirmButton = { TextButton(onClick = { scope.launch {
                        val id = editingAnnouncementId ?: return@launch
                        val saved = mutateAnnouncement("PATCH", mapOf(
                            "id" to id, "action" to "edit",
                            "title" to editingAnnouncementTitle.trim(),
                            "category" to editingAnnouncementCategory.trim(),
                            "body" to editingAnnouncementBody.trim()
                        ))
                        if (saved.isSuccessful) {
                            if (saved.queued) {
                                announcements = announcements.map { item ->
                                    if (item.id == id) item.copy(
                                        title = editingAnnouncementTitle.trim(),
                                        category = editingAnnouncementCategory.trim(),
                                        body = editingAnnouncementBody.trim(),
                                        status = "DRAFT"
                                    ) else item
                                }
                            } else {
                                val refreshed = api.announcements()
                                if (refreshed.isSuccessful) announcements = refreshed.body()?.announcements.orEmpty()
                            }
                            showAnnouncementEditDialog = false
                            editingAnnouncementId = null
                        } else moduleError = saved.message ?: "Announcement draft could not be updated."
                    } }, enabled = editingAnnouncementTitle.isNotBlank() && editingAnnouncementBody.isNotBlank()) { Text("SAVE CHANGES") } },
                    dismissButton = { TextButton(onClick = { showAnnouncementEditDialog = false }) { Text("CANCEL") } }
                )
                deleteAnnouncementTarget?.let { target ->
                    AlertDialog(
                        onDismissRequest = { deleteAnnouncementTarget = null },
                        title = { Text("Delete announcement?") },
                        text = { Text("Permanently delete ${target.title}? This action cannot be undone.") },
                        confirmButton = {
                            TextButton(onClick = {
                                scope.launch {
                                    try {
                                        val deleted = api.deleteAnnouncement(target.id)
                                        if (deleted.isSuccessful) {
                                            announcements = announcements.filterNot { it.id == target.id }
                                            deleteAnnouncementTarget = null
                                        } else moduleError = "Announcement could not be deleted (HTTP ${deleted.code()})."
                                    } catch (_: Exception) {
                                        moduleError = "Deletion requires a live connection. The announcement was not removed locally."
                                    }
                                }
                            }) { Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78)) }
                        },
                        dismissButton = { TextButton(onClick = { deleteAnnouncementTarget = null }) { Text("CANCEL") } }
                    )
                }
            } else {
                AvaVoiceScreen(api)
            }
        }
    }
}

@Composable
private fun CoursePicker(courses: List<CourseDto>, selectedId: String?, onSelected: (String?) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selected = courses.firstOrNull { it.id == selectedId }
    Box {
        OutlinedTextField(
            value = selected?.let { "${it.code} / ${it.name}" } ?: "No course linked",
            onValueChange = {},
            readOnly = true,
            label = { Text("Course (optional)") },
            modifier = Modifier.fillMaxWidth().clickable { expanded = true }
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text("No course linked") },
                onClick = { onSelected(null); expanded = false }
            )
            courses.forEach { course ->
                DropdownMenuItem(
                    text = { Text("${course.code} / ${course.name}") },
                    onClick = { onSelected(course.id); expanded = false }
                )
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
