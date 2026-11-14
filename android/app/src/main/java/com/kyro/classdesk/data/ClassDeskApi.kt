package com.kyro.classdesk.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.DELETE
import retrofit2.http.POST
import retrofit2.http.Query
import retrofit2.http.Multipart
import retrofit2.http.Part
import retrofit2.http.PartMap
import okhttp3.MultipartBody
import okhttp3.RequestBody

interface ClassDeskApi {
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    @GET("api/auth/me")
    suspend fun session(): Response<SessionResponse>

    @GET("api/academic")
    suspend fun summary(@Query("resource") resource: String = "summary"): Response<SummaryEnvelope>

    @GET("api/academic")
    suspend fun courses(@Query("resource") resource: String = "courses"): Response<CoursesEnvelope>

    @GET("api/academic")
    suspend fun assignments(@Query("resource") resource: String = "assignments"): Response<AssignmentsEnvelope>

    @GET("api/academic")
    suspend fun lectures(@Query("resource") resource: String = "lectures"): Response<LecturesEnvelope>

    @GET("api/academic")
    suspend fun attendance(@Query("resource") resource: String = "attendance"): Response<AttendanceEnvelope>

    @GET("api/academic")
    suspend fun concerns(@Query("resource") resource: String = "concerns"): Response<ConcernsEnvelope>

    @POST("api/sync")
    suspend fun pushSync(@Body body: SyncPushRequest): Response<SyncPushResponse>

    @POST("api/ai/chat")
    suspend fun chat(@Body body: ChatRequest): Response<ChatResponse>

    @GET("api/announcements")
    suspend fun announcements(): Response<AnnouncementsEnvelope>

    @GET("api/documents")
    suspend fun documents(): Response<DocumentsEnvelope>

    @Multipart
    @POST("api/documents")
    suspend fun uploadDocument(@Part file: MultipartBody.Part, @PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>): Response<Map<String, Any>>

    @DELETE("api/documents")
    suspend fun deleteDocument(@Query("id") id: String): Response<Map<String, Any>>

    @POST("api/announcements")
    suspend fun createAnnouncement(@Body body: Map<String, String>): Response<Map<String, Any>>

    @PATCH("api/announcements")
    suspend fun updateAnnouncement(@Body body: Map<String, String>): Response<Map<String, Any>>

    @POST("api/academic")
    suspend fun createAcademic(@Body body: Map<String, String>): Response<Map<String, Any>>

    @PATCH("api/academic")
    suspend fun updateAcademic(@Body body: Map<String, String>): Response<Map<String, Any>>

    @DELETE("api/academic")
    suspend fun deleteAcademic(@Query("resource") resource: String, @Query("id") id: String): Response<Map<String, Any>>
}
