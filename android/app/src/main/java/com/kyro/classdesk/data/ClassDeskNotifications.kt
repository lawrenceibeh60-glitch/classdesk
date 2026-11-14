package com.kyro.classdesk.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.kyro.classdesk.MainActivity

object ClassDeskNotifications {
    const val CHANNEL_UPDATES = "classdesk_updates"
    const val CHANNEL_SYNC = "classdesk_sync"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_UPDATES, "Class updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Published announcements and important class updates"
        })
        manager.createNotificationChannel(NotificationChannel(CHANNEL_SYNC, "Offline sync", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Confirmation when offline changes are synchronised"
        })
    }

    fun canPost(context: Context): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun announcement(context: Context, id: String, title: String) {
        post(context, id.hashCode(), CHANNEL_UPDATES, "New class announcement", title, "Announcements")
    }

    fun assignment(context: Context, id: String, title: String, dueAt: String?) {
        val detail = dueAt?.takeIf { it.isNotBlank() }?.let { "Due: $it" } ?: "A new assignment is available."
        post(context, id.hashCode(), CHANNEL_UPDATES, "New assignment", "$title — $detail", "Tasks")
    }

    fun timetable(context: Context, id: String, title: String, date: String?) {
        val detail = date?.takeIf { it.isNotBlank() } ?: "A new class event is available."
        post(context, id.hashCode(), CHANNEL_UPDATES, "Timetable update", "$title — $detail", "Calendar")
    }

    fun attendance(context: Context, id: String) {
        post(context, id.hashCode(), CHANNEL_UPDATES, "Attendance updated", "A new class attendance record is available.", "Attendance")
    }

    fun concern(context: Context, id: String, status: String) {
        post(context, id.hashCode(), CHANNEL_UPDATES, "Class concern updated", "A concern status changed to ${status.lowercase()}.", "Concerns")
    }

    fun syncCompleted(context: Context, count: Int) {
        if (count > 0) post(context, 81001, CHANNEL_SYNC, "ClassDesk is up to date",
            "$count offline change${if (count == 1) "" else "s"} synchronised successfully.", "Sync Queue")
    }

    private fun post(context: Context, id: Int, channel: String, title: String, body: String, destination: String) {
        createChannels(context)
        if (!canPost(context)) return
        val openApp = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).apply {
            putExtra("classdesk_destination", destination)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(com.kyro.classdesk.R.drawable.ic_classdesk)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp).setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT).build()
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}

class ClassDeskConnectivity(context: Context) {
    private val manager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    fun isOnline(): Boolean {
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
    fun register(onChanged: (Boolean) -> Unit): ConnectivityManager.NetworkCallback {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { onChanged(isOnline()) }
            override fun onLost(network: Network) { onChanged(isOnline()) }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { onChanged(isOnline()) }
        }
        manager.registerDefaultNetworkCallback(callback)
        return callback
    }
    fun unregister(callback: ConnectivityManager.NetworkCallback) { runCatching { manager.unregisterNetworkCallback(callback) } }
}
