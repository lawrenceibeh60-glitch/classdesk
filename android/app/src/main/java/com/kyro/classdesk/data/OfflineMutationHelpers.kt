package com.kyro.classdesk.data

import android.content.Context
import com.google.gson.Gson
import java.util.UUID
import retrofit2.Response

data class OfflineMutationResult(
    val isSuccessful: Boolean,
    val queued: Boolean = false,
    private val statusCode: Int = 0,
    val message: String? = null
) {
    fun code(): Int = statusCode
}

/**
 * Sends an academic mutation immediately. If the network is unavailable, it stores
 * an encrypted, account-bound mutation for ClassDeskSyncWorker to replay later.
 * HTTP validation/permission failures are never silently queued.
 */
suspend fun saveAcademicMutation(
    context: Context,
    user: UserDto,
    api: ClassDeskApi,
    resource: String,
    method: String,
    input: Map<String, String>
): OfflineMutationResult {
    val id = input["id"] ?: UUID.randomUUID().toString()
    val payload = input + mapOf("id" to id, "resource" to resource)
    return try {
        val response = when (method) {
            "POST" -> api.createAcademic(payload)
            "PATCH" -> api.updateAcademic(payload)
            "DELETE" -> api.deleteAcademic(resource, id)
            else -> return OfflineMutationResult(false, message = "Unsupported offline mutation.")
        }
        OfflineMutationResult(response.isSuccessful, statusCode = response.code(), message = response.errorBody()?.string())
    } catch (_: Exception) {
        val store = OfflineStore(context)
        try {
            store.enqueue(PendingMutation(
                id = UUID.randomUUID().toString(),
                ownerUsername = user.username,
                entityId = id,
                operation = "academic:$method:$resource",
                baseVersion = 0,
                payloadJson = Gson().toJson(payload)
            ))
            ClassDeskSyncScheduler.scheduleNow(context)
        } finally { store.closeStore() }
        OfflineMutationResult(true, queued = true, statusCode = 0, message = "Saved on this device. It will sync when the network returns.")
    }
}

suspend fun saveAnnouncementMutation(
    context: Context,
    user: UserDto,
    api: ClassDeskApi,
    method: String,
    input: Map<String, String>
): OfflineMutationResult {
    val id = input["id"] ?: UUID.randomUUID().toString()
    val payload = input + mapOf("id" to id)
    return try {
        val response = when (method) {
            "POST" -> api.createAnnouncement(payload)
            "PATCH" -> api.updateAnnouncement(payload)
            else -> return OfflineMutationResult(false, message = "Unsupported announcement mutation.")
        }
        OfflineMutationResult(response.isSuccessful, statusCode = response.code(), message = response.errorBody()?.string())
    } catch (_: Exception) {
        val store = OfflineStore(context)
        try {
            store.enqueue(PendingMutation(
                id = UUID.randomUUID().toString(),
                ownerUsername = user.username,
                entityId = id,
                operation = "announcement:$method",
                baseVersion = 0,
                payloadJson = Gson().toJson(payload)
            ))
            ClassDeskSyncScheduler.scheduleNow(context)
        } finally { store.closeStore() }
        OfflineMutationResult(true, queued = true, statusCode = 0, message = "Announcement change saved locally and queued for synchronization.")
    }
}
