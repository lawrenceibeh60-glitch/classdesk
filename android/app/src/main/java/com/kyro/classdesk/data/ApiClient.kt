package com.kyro.classdesk.data

import android.content.Context
import com.kyro.classdesk.BuildConfig
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    @Volatile private var api: ClassDeskApi? = null
    @Volatile private var cookieJar: SessionCookieJar? = null

    fun cookies(context: Context): SessionCookieJar =
        cookieJar ?: synchronized(this) {
            cookieJar ?: SessionCookieJar(context.applicationContext).also { cookieJar = it }
        }

    fun get(context: Context): ClassDeskApi =
        api ?: synchronized(this) {
            api ?: Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE_URL)
                .client(OkHttpClient.Builder()
                    .cookieJar(cookies(context))
                    .connectTimeout(20, TimeUnit.SECONDS)
                    .readTimeout(45, TimeUnit.SECONDS)
                    .writeTimeout(45, TimeUnit.SECONDS)
                    .build())
                .addConverterFactory(GsonConverterFactory.create())
                .build().create(ClassDeskApi::class.java).also { api = it }
        }
}
