package com.kyro.classdesk.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.DELETE
import retrofit2.http.POST
import retrofit2.http.Query

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

    @POST("api/academic")
    suspend fun createAcademic(@Body body: Map<String, String>): Response<Map<String, Any>>

    @PATCH("api/academic")
    suspend fun updateAcademic(@Body body: Map<String, String>): Response<Map<String, Any>>

    @DELETE("api/academic")
    suspend fun deleteAcademic(@Query("resource") resource: String, @Query("id") id: String): Response<Map<String, Any>>
}
