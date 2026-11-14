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

data class ChatRequest(val message: String, val voice: Boolean = true, val history: List<ChatHistoryItem> = emptyList(), val clientRequestId: String? = null)
data class ChatHistoryItem(val role: String, val content: String)
data class AvaActionConfirmationDto(val type: String, val documentId: String, val title: String, val filename: String, val sizeBytes: Int, val originalInSharedStorage: Boolean)
data class ChatResponse(val answer: String?, val error: String?, val actionConfirmation: AvaActionConfirmationDto? = null)

data class LectureDto(val id: String, val topic: String, val summary: String?, val scheduledAt: String?, val heldAt: String?, val venue: String?, val lecturer: String?, val course: CourseRef?)
data class LecturesEnvelope(val items: List<LectureDto>?)
data class AttendanceDto(val id: String, val sessionDate: String, val presentCount: Int, val absentCount: Int, val note: String?, val course: CourseRef?)
data class AttendanceEnvelope(val items: List<AttendanceDto>?)
data class ConcernDto(val id: String, val category: String, val title: String, val details: String, val status: String, val resolution: String?)
data class ConcernsEnvelope(val items: List<ConcernDto>?)

data class AnnouncementDto(val id: String, val title: String, val body: String, val category: String, val status: String, val publishedAt: String?)
data class AnnouncementsEnvelope(val announcements: List<AnnouncementDto>?)

data class DocumentDto(val id: String, val title: String, val filename: String, val mimeType: String, val sizeBytes: Int, val courseCode: String?, val topic: String?, val status: String, val securityScanStatus: String, val createdAt: String, val originalAvailable: Boolean)
data class DocumentsEnvelope(val documents: List<DocumentDto>?)

data class AcademicRecordDto(val id: String, val type: String, val title: String, val content: String, val eventDate: String?, val status: String, val version: Int)
data class RecordsEnvelope(val records: List<AcademicRecordDto>?)


data class AvaTaskDto(
    val id: String,
    val kind: String,
    val status: String,
    val progress: Int = 0,
    val currentStep: String = "Queued",
    val errorMessage: String?,
    val resultDocumentId: String?,
    val createdAt: String
)
data class AvaTasksEnvelope(val tasks: List<AvaTaskDto>?, val workerOnline: Boolean = false)
data class AvaTaskCreateRequest(val kind: String, val documentIds: List<String>, val prompt: String, val clientRequestId: String? = null)
data class AvaTaskCreateEnvelope(val task: AvaTaskDto?, val message: String?, val error: String?)
