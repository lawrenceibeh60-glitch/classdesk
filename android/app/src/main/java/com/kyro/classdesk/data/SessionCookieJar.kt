package com.kyro.classdesk.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class SessionCookieJar(context: Context) : CookieJar {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "classdesk_secure_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val current = loadForRequest(url).associateBy { it.name }.toMutableMap()
        cookies.forEach { cookie ->
            if (cookie.expiresAt <= System.currentTimeMillis()) current.remove(cookie.name)
            else current[cookie.name] = cookie
        }
        preferences.edit().putString("cookies", current.values.joinToString("\n") { it.toString() }).apply()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        preferences.getString("cookies", "").orEmpty().lineSequence()
            .mapNotNull { Cookie.parse(url, it) }
            .filter { it.expiresAt > System.currentTimeMillis() }.toList()

    fun clear() { preferences.edit().remove("cookies").apply() }
}
