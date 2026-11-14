package com.kyro.classdesk.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
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

    @POST("api/sync")
    suspend fun pushSync(@Body body: SyncPushRequest): Response<SyncPushResponse>
}
