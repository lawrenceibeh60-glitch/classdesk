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
import java.util.concurrent.TimeUnit

class ClassDeskSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = OfflineStore(applicationContext)
        try {
            val owner = ApiClient.cookies(applicationContext).loadUser() ?: return Result.success()
            val queued = store.pending(owner.username, 100)
            if (queued.isEmpty()) return Result.success()
            val mutations = queued.map { row ->
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
                return if (response.code() >= 500 || response.code() == 429) Result.retry() else Result.success()
            }
            val body = response.body() ?: return Result.retry()
            store.removeApplied(body.appliedIds.orEmpty())
            body.conflicts.orEmpty().forEach { store.mark(it.id, "CONFLICT", it.reason) }
            body.rejected.orEmpty().forEach { store.mark(it.id, "REJECTED", it.reason) }
            return if (body.appliedIds.orEmpty().size == queued.size) Result.success() else Result.success()
        } catch (_: Exception) {
            return Result.retry()
        } finally { store.closeStore() }
    }
}

object ClassDeskSyncScheduler {
    fun scheduleNow(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<ClassDeskSyncWorker>().setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniqueWork("classdesk-offline-sync-now", ExistingWorkPolicy.KEEP, request)
    }

    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<ClassDeskSyncWorker>(6, TimeUnit.HOURS)
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
