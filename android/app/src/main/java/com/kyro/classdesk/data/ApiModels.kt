package com.kyro.classdesk.data

data class LoginRequest(val username: String, val password: String)
data class LoginResponse(val ok: Boolean, val user: UserDto?, val error: String?)
data class SessionResponse(val user: UserDto?, val error: String?)
data class UserDto(val username: String, val displayName: String, val role: String)
data class SummaryEnvelope(val summary: SummaryDto?, val upcomingAssignments: List<AssignmentDto>?)
data class SummaryDto(val courses: Int = 0, val lectures: Int = 0, val assignments: Int = 0, val concerns: Int = 0)
data class AssignmentDto(val id: String, val title: String, val dueAt: String?, val status: String?, val course: CourseRef?)
data class CourseRef(val id: String?, val code: String?, val name: String?)
