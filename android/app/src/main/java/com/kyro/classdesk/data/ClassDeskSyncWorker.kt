package com.kyro.classdesk.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.ExistingWorkPolicy
import androidx.work.WorkManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.gson.JsonParser
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.util.concurrent.TimeUnit

class ClassDeskSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = OfflineStore(applicationContext)
        try {
            val cookies = ApiClient.cookies(applicationContext)
            val owner = cookies.loadUser() ?: return Result.success()
            // Periodic authenticated polling provides background local alerts without exposing
            // account data to a third-party push provider. WorkManager may defer this on Android.
            try {
                val announcementResponse = ApiClient.get(applicationContext).announcements()
                if (announcementResponse.isSuccessful) {
                    val latest = announcementResponse.body()?.announcements.orEmpty()
                    val previous = cookies.loadSnapshot("announcements")?.let {
                        runCatching { Gson().fromJson(it, Array<AnnouncementDto>::class.java)?.toList() }.getOrNull()
                    }
                    if (previous != null && ClassDeskNotifications.canPost(applicationContext)) {
                        val knownIds = previous.map { it.id }.toSet()
                        latest.filter { it.status.equals("PUBLISHED", true) && it.id !in knownIds }
                            .forEach { ClassDeskNotifications.announcement(applicationContext, it.id, it.title) }
                    }
                    cookies.saveSnapshot("announcements", Gson().toJson(latest))
                }
            } catch (_: Exception) { /* Keep notification polling independent from offline mutation replay. */ }
            try {
                val response = ApiClient.get(applicationContext).assignments()
                if (response.isSuccessful) {
                    val latest = response.body()?.items.orEmpty()
                    val previous = cookies.loadSnapshot("assignments")?.let {
                        runCatching { Gson().fromJson(it, Array<AssignmentDto>::class.java)?.toList() }.getOrNull()
                    }
                    if (previous != null && ClassDeskNotifications.canPost(applicationContext)) {
                        val known = previous.map { it.id }.toSet()
                        latest.filter { it.id !in known }.forEach {
                            ClassDeskNotifications.assignment(applicationContext, it.id, it.title, it.dueAt)
                        }
                    }
                    cookies.saveSnapshot("assignments", Gson().toJson(latest))
                }
            } catch (_: Exception) { }
            try {
                val response = ApiClient.get(applicationContext).records()
                if (response.isSuccessful) {
                    val latest = response.body()?.records.orEmpty()
                    val previous = cookies.loadSnapshot("calendar")?.let {
                        runCatching { Gson().fromJson(it, Array<AcademicRecordDto>::class.java)?.toList() }.getOrNull()
                    }
                    if (previous != null && ClassDeskNotifications.canPost(applicationContext)) {
                        val known = previous.map { it.id }.toSet()
                        latest.filter { it.id !in known && it.type.uppercase() in listOf("TIMETABLE", "CALENDAR") }
                            .forEach { ClassDeskNotifications.timetable(applicationContext, it.id, it.title, it.eventDate) }
                    }
                    cookies.saveSnapshot("calendar", Gson().toJson(latest))
                }
            } catch (_: Exception) { }
            try {
                val response = ApiClient.get(applicationContext).attendance()
                if (response.isSuccessful) {
                    val latest = response.body()?.items.orEmpty()
                    val previous = cookies.loadSnapshot("attendance")?.let {
                        runCatching { Gson().fromJson(it, Array<AttendanceDto>::class.java)?.toList() }.getOrNull()
                    }
                    if (previous != null && ClassDeskNotifications.canPost(applicationContext)) {
                        val known = previous.map { it.id }.toSet()
                        latest.filter { it.id !in known }.forEach { ClassDeskNotifications.attendance(applicationContext, it.id) }
                    }
                    cookies.saveSnapshot("attendance", Gson().toJson(latest))
                }
            } catch (_: Exception) { }
            try {
                val response = ApiClient.get(applicationContext).concerns()
                if (response.isSuccessful) {
                    val latest = response.body()?.items.orEmpty()
                    val previous = cookies.loadSnapshot("concerns")?.let {
                        runCatching { Gson().fromJson(it, Array<ConcernDto>::class.java)?.toList() }.getOrNull()
                    }
                    if (previous != null && ClassDeskNotifications.canPost(applicationContext)) {
                        val oldById = previous.associateBy { it.id }
                        latest.filter { oldById[it.id]?.status != null && oldById[it.id]?.status != it.status }
                            .forEach { ClassDeskNotifications.concern(applicationContext, it.id, it.status) }
                    }
                    cookies.saveSnapshot("concerns", Gson().toJson(latest))
                }
            } catch (_: Exception) { }
            val queued = store.pending(owner.username, 100)
            if (queued.isEmpty()) return Result.success()
            var appliedCount = 0
            val moduleRows = queued.filter { it.operation.startsWith("academic:") || it.operation.startsWith("announcement:") }
            for (row in moduleRows) {
                val parts = row.operation.split(":")
                val payloadType = object : TypeToken<Map<String, String>>() {}.type
                val payload: Map<String, String> = Gson().fromJson(row.payloadJson, payloadType)
                val response = when (parts.firstOrNull()) {
                    "academic" -> {
                        val method = parts.getOrNull(1)
                        val resource = parts.getOrNull(2) ?: return Result.success()
                        when (method) {
                            "POST" -> ApiClient.get(applicationContext).createAcademic(payload)
                            "PATCH" -> ApiClient.get(applicationContext).updateAcademic(payload)
                            "DELETE" -> ApiClient.get(applicationContext).deleteAcademic(resource, row.entityId)
                            else -> return Result.success()
                        }
                    }
                    "announcement" -> when (parts.getOrNull(1)) {
                        "POST" -> ApiClient.get(applicationContext).createAnnouncement(payload)
                        "PATCH" -> ApiClient.get(applicationContext).updateAnnouncement(payload)
                        else -> return Result.success()
                    }
                    else -> return Result.success()
                }
                if (response.isSuccessful || (parts.getOrNull(1) == "DELETE" && response.code() == 404)) {
                    store.removeApplied(listOf(row.id))
                    appliedCount += 1
                } else if (response.code() == 401) {
                    return Result.success()
                } else if (response.code() >= 500 || response.code() == 429) {
                    return Result.retry()
                } else {
                    store.mark(row.id, "REJECTED", "The server rejected this queued change (HTTP " + response.code() + "). The original payload is retained.")
                }
            }
            val recordRows = queued.filterNot { it.operation.startsWith("academic:") || it.operation.startsWith("announcement:") }
            if (recordRows.isEmpty()) {
                ClassDeskNotifications.syncCompleted(applicationContext, appliedCount)
                return Result.success()
            }
            val mutations = recordRows.map { row ->
                SyncMutationDto(
                    id = row.id,
                    entityId = row.entityId,
                    operation = row.operation,
                    baseVersion = row.baseVersion,
                    payload = JsonParser.parseString(row.payloadJson).asJsonObject
                )
            }
            val response = ApiClient.get(applicationContext).pushSync(SyncPushRequest(mutations))
            if (!response.isSuccessful) {
                if (response.code() >= 500 || response.code() == 429) return Result.retry()
                if (response.code() == 401) return Result.success() // Preserve the queue until this account signs in again.
                queued.forEach { store.mark(it.id, "REJECTED", "The server rejected this sync batch (HTTP ${response.code()}).") }
                return Result.success()
            }
            val body = response.body() ?: return Result.retry()
            store.removeApplied(body.appliedIds.orEmpty())
            appliedCount += body.appliedIds.orEmpty().size
            body.conflicts.orEmpty().forEach { store.mark(it.id, "CONFLICT", it.reason) }
            body.rejected.orEmpty().forEach { store.mark(it.id, "REJECTED", it.reason) }
            ClassDeskNotifications.syncCompleted(applicationContext, appliedCount)
            return Result.success()
        } catch (_: Exception) {
            return Result.retry()
        } finally { store.closeStore() }
    }
}

object ClassDeskSyncScheduler {
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("classdesk-offline-sync-now")
        WorkManager.getInstance(context).cancelUniqueWork("classdesk-offline-sync")
    }

    fun scheduleNow(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<ClassDeskSyncWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniqueWork("classdesk-offline-sync-now", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<ClassDeskSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "classdesk-offline-sync",
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }
}
