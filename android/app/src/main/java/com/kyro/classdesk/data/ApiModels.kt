package com.kyro.classdesk.data

data class LoginRequest(val username: String, val password: String)
data class LoginResponse(val ok: Boolean, val user: UserDto?, val error: String?)
data class SessionResponse(val user: UserDto?, val error: String?)
data class UserDto(val username: String, val displayName: String, val role: String)
data class SummaryEnvelope(val summary: SummaryDto?, val upcomingAssignments: List<AssignmentDto>?)
data class SummaryDto(val courses: Int = 0, val lectures: Int = 0, val assignments: Int = 0, val concerns: Int = 0)
data class AssignmentDto(val id: String, val title: String, val dueAt: String?, val status: String?, val course: CourseRef?)
data class CourseRef(val id: String?, val code: String?, val name: String?)

data class CourseDto(val id: String, val code: String, val name: String, val lecturer: String?, val semester: String?, val active: Boolean)
data class CoursesEnvelope(val items: List<CourseDto>?)
data class AssignmentsEnvelope(val items: List<AssignmentDto>?)
data class SyncMutationDto(val id: String, val entityType: String = "record", val entityId: String, val operation: String, val baseVersion: Int, val payload: com.google.gson.JsonObject)
data class SyncPushRequest(val mutations: List<SyncMutationDto>)
data class SyncConflictDto(val id: String, val entityId: String, val reason: String)
data class SyncRejectedDto(val id: String, val reason: String)
data class SyncPushResponse(val appliedIds: List<String>?, val conflicts: List<SyncConflictDto>?, val rejected: List<SyncRejectedDto>?)

data class ChatRequest(val message: String, val voice: Boolean = true, val history: List<ChatHistoryItem> = emptyList())
data class ChatHistoryItem(val role: String, val content: String)
data class ChatResponse(val answer: String?, val error: String?)
