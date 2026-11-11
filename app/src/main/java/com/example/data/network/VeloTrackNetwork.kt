package com.example.data.network

import android.content.Context
import com.example.BuildConfig
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.Cache
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class LoginRequestDto(
    val identifier: String,
    val email: String = identifier,
    val password: String
)

data class ChangePasswordRequestDto(
    val currentPassword: String,
    val newPassword: String
)

data class ServerUserDto(
    val id: String,
    val username: String? = null,
    val email: String? = null,
    val phone: String = "",
    val fullName: String,
    val role: String,
    val mustChangePassword: Boolean = false,
    val isActive: Boolean = true,
    val createdAtMs: Long = 0L
)

data class LoginResponseDto(
    val token: String,
    val mustChangePassword: Boolean = false,
    val user: ServerUserDto
)

data class WsTicketResponseDto(
    val ticket: String,
    val expiresAtMs: Long = 0L
)

data class ServerDeviceProfileDto(
    val id: String,
    val manufacturer: String,
    val model: String,
    val firmwareVersion: String,
    val traccarProtocol: String = "gt06",
    val serverHost: String,
    val serverPort: Int = 5023,
    val transport: String = "TCP",
    val serverMode: String = "DOMAIN",
    val requiresDevicePassword: Boolean = false,
    val defaultDevicePassword: String? = null,
    val requiresGprsonCommand: Boolean = false,
    val serverCommandTemplate: String,
    val gprsonCommandTemplate: String? = null,
    val optionalTimerCommandTemplate: String? = null,
    val expectedReplyPattern: String? = null,
    val supportedCommands: List<String> = emptyList(),
    val isVerified: Boolean = false
)

data class CreateProfileRequestDto(
    val manufacturer: String,
    val model: String,
    val firmwareVersion: String,
    val serverHost: String,
    val serverPort: Int = 5023,
    val transport: String = "TCP",
    val serverMode: String = "DOMAIN",
    val requiresDevicePassword: Boolean = false,
    val defaultDevicePassword: String? = null,
    val requiresGprsonCommand: Boolean = false,
    val serverCommandTemplate: String,
    val gprsonCommandTemplate: String? = null,
    val optionalTimerCommandTemplate: String? = null,
    val expectedReplyPattern: String? = null
)

data class ServerDeviceDto(
    val id: String,
    val imei: String,
    val serialNumber: String? = null,
    val traccarDeviceId: Long,
    val profileId: String,
    val currentCustomerId: String,
    val vehicleName: String,
    val vehicleType: String = "CAR",
    val vehicleIcon: String = "car",
    val plateNumber: String,
    val simLocalNumber: String,
    val simE164Number: String,
    val activationStatus: String,
    val connectionState: String,
    val hasValidFix: Boolean = false,
    val lastLat: Double? = null,
    val lastLng: Double? = null,
    val lastSpeedKmh: Float? = null,
    val lastHeading: Float? = null,
    val ignitionOn: Boolean? = null,
    val firstConnectedAtMs: Long? = null,
    val lastSeenAtMs: Long? = null,
    val createdAtMs: Long = 0L
)

data class ServerSubscriptionDto(
    val id: String,
    val deviceId: String,
    val customerId: String,
    val planDuration: String,
    val status: String,
    val startedAtMs: Long? = null,
    val expiresAtMs: Long? = null,
    val adminOverrideBy: String? = null,
    val adminOverrideReason: String? = null
)

data class ServerSmsLogDto(
    val id: String,
    val deviceId: String,
    val stepOrder: Int,
    val commandKey: String,
    val commandText: String,
    val gatewayMessageId: String? = null,
    val status: String,
    val deviceReply: String? = null,
    val failureReason: String? = null,
    val sentAtMs: Long = 0L,
    val completedAtMs: Long? = null
)

data class ServerSubHistoryDto(
    val id: String,
    val deviceId: String,
    val customerId: String,
    val actionType: String,
    val planDuration: String,
    val notes: String,
    val createdAtMs: Long = 0L
)

data class ServerOwnershipHistoryDto(
    val id: String,
    val deviceId: String,
    val previousCustomerId: String? = null,
    val newCustomerId: String,
    val reassignedByAdminId: String,
    val reason: String,
    val reassignedAtMs: Long = 0L
)

data class ServerDeviceCommandDto(
    val id: String,
    val deviceId: String,
    val traccarDeviceId: Long = 0L,
    val issuedByUserId: String = "",
    val issuedByRole: String = "CUSTOMER",
    val commandType: String,
    val status: String,
    val failureReason: String? = null,
    val sentAtMs: Long = 0L,
    val completedAtMs: Long? = null
)

data class ServerDeviceBundleDto(
    val device: ServerDeviceDto,
    val subscription: ServerSubscriptionDto,
    val customer: ServerUserDto? = null,
    val profile: ServerDeviceProfileDto? = null,
    val smsLogs: List<ServerSmsLogDto> = emptyList(),
    val subscriptionHistory: List<ServerSubHistoryDto> = emptyList(),
    val ownershipHistory: List<ServerOwnershipHistoryDto> = emptyList(),
    val commands: List<ServerDeviceCommandDto> = emptyList()
)

data class ActivateDeviceRequestDto(
    val profileId: String,
    val imei: String,
    val serialNumber: String? = null,
    val customerId: String,
    val vehicleName: String,
    val vehicleType: String = "CAR",
    val vehicleIcon: String = "car",
    val plateNumber: String,
    val planDuration: String,
    val simLocalWithoutPlus20: String,
    val autoSendSms: Boolean = true
)

data class ActivateDeviceResponseDto(
    val device: ServerDeviceDto,
    val subscription: ServerSubscriptionDto,
    val smsLogs: List<ServerSmsLogDto> = emptyList()
)

data class SendActivationSmsRequestDto(
    val idempotencyKey: String? = null
)

data class SendActivationSmsResponseDto(
    val duplicatePrevented: Boolean = false,
    val smsLogs: List<ServerSmsLogDto> = emptyList()
)

data class AdminOverrideRequestDto(
    val auditReason: String
)

data class ReassignCustomerRequestDto(
    val newCustomerId: String,
    val reason: String
)

data class RenewSubscriptionRequestDto(
    val planDuration: String
)

data class ReasonRequestDto(
    val reason: String
)

data class UpdateVehicleMetadataRequestDto(
    val vehicleName: String? = null,
    val vehicleType: String? = null,
    val vehicleIcon: String? = null,
    val plateNumber: String? = null,
    val serialNumber: String? = null,
    val simLocalWithoutPlus20: String? = null
)

data class SendDeviceCommandRequestDto(
    val type: String,
    val attributes: Map<String, Any?> = emptyMap(),
    val confirmed: Boolean = false
)

data class ServerRoutePointDto(
    val traccarPositionId: Long,
    val traccarDeviceId: Long,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Float,
    val heading: Float,
    val valid: Boolean,
    val ignition: Boolean,
    val recordedAtMs: Long
)

data class ServerHealthResponseDto(
    val status: String,
    val version: String = "1.2.0",
    val schemaVersion: String = "003_customer_device_guard_and_fleet_ops",
    val supabaseConnected: Boolean = false,
    val traccarConnected: Boolean = false,
    val traccarWsConnected: Boolean = false,
    val traccarLastSyncAtMs: Long? = null,
    val smsGatewayConfigured: Boolean = false
)

data class CheckUpdateRequestDto(
    val autoUpdateEnabled: Boolean = true
)

data class ServerSystemVersionDto(
    val currentVersion: String = "1.3.0",
    val schemaVersion: String = "003_customer_device_guard_and_schema_migrations",
    val repository: String = "mahmoudhindam9-stack/gps",
    val latestVersion: String = "1.3.0",
    val tagName: String = "v1.3.0",
    val releaseName: String = "VeloTrack GPS v1.3.0",
    val publishedAt: String? = null,
    val htmlUrl: String = "https://github.com/mahmoudhindam9-stack/gps/releases",
    val apkDownloadUrl: String? = null,
    val webBundleDownloadUrl: String? = null,
    val releaseNotes: String = "",
    val updateAvailable: Boolean = false,
    val autoUpdateEnabled: Boolean = true,
    val checkedAtMs: Long = 0L,
    val status: String = "UP_TO_DATE"
)

data class ServerFleetEventDto(
    val id: Long,
    val type: String,
    val eventTime: String? = null,
    val eventTimeMs: Long? = null,
    val deviceId: String,
    val vehicleName: String,
    val plateNumber: String = "",
    val traccarDeviceId: Long = 0L,
    val positionId: Long? = null,
    val geofenceId: Long? = null,
    val attributes: Map<String, Any?> = emptyMap()
)

data class ServerMileageSummaryDto(
    val deviceId: String,
    val vehicleName: String,
    val plateNumber: String = "",
    val traccarDeviceId: Long = 0L,
    val distanceMeters: Double? = null,
    val distanceKm: Double? = null,
    val averageSpeedKmh: Double? = null,
    val maxSpeedKmh: Double? = null,
    val spentFuelLiters: Double? = null,
    val engineHours: Double? = null
)

data class ServerFleetTelemetryDto(
    val deviceId: String,
    val vehicleName: String,
    val plateNumber: String = "",
    val traccarDeviceId: Long = 0L,
    val connectionState: String = "OFFLINE",
    val hasValidFix: Boolean = false,
    val reportedAtMs: Long? = null,
    val values: Map<String, Any?> = emptyMap()
)

data class ServerGeofenceDto(
    val id: Long,
    val name: String,
    val description: String = "",
    val area: String,
    val deviceIds: List<String> = emptyList(),
    val vehicleNames: List<String> = emptyList(),
    val attributes: Map<String, Any?> = emptyMap()
)

data class CreateGeofenceRequestDto(
    val name: String,
    val description: String = "",
    val area: String,
    val deviceIds: List<String>
)

data class DeleteGeofenceResponseDto(
    val id: Long,
    val deleted: Boolean = false
)

data class CreateDeviceShareRequestDto(
    val expiresInHours: Int = 24
)

data class ServerDeviceShareResponseDto(
    val deviceId: String,
    val vehicleName: String,
    val token: String = "",
    val shareUrl: String,
    val expiresAt: String,
    val expiresAtMs: Long? = null
)

data class TraccarSyncResponseDto(
    val updatedDeviceIds: List<String> = emptyList(),
    val syncedAtMs: Long? = null
)

data class LiveWsFrameDto(
    val type: String,
    val timestampMs: Long = 0L,
    val devices: List<ServerDeviceBundleDto> = emptyList(),
    val error: String? = null
)

// Official Traccar REST / WebSocket DTOs for protocol parsing & integration tests
data class TraccarDeviceDto(
    val id: Long,
    val name: String,
    val uniqueId: String,
    val status: String? = null,
    val lastUpdate: String? = null
)

data class TraccarPositionDto(
    val id: Long,
    val deviceId: Long,
    val valid: Boolean = false,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val speed: Double = 0.0, // knots in Traccar API
    val course: Double = 0.0,
    val fixTime: String? = null,
    val attributes: Map<String, Any?> = emptyMap()
)

data class TraccarSocketFrameDto(
    val devices: List<TraccarDeviceDto>? = null,
    val positions: List<TraccarPositionDto>? = null
)

interface VeloTrackApiService {
    @GET("api/v1/health")
    suspend fun getHealth(): Response<ServerHealthResponseDto>

    @POST("api/v1/auth/login")
    suspend fun login(
        @Body request: LoginRequestDto
    ): Response<LoginResponseDto>

    @POST("api/v1/auth/change-password")
    suspend fun changePassword(
        @Body request: ChangePasswordRequestDto
    ): Response<LoginResponseDto>

    @POST("api/v1/auth/ws-ticket")
    suspend fun createWsTicket(): Response<WsTicketResponseDto>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<ServerUserDto>

    @GET("api/v1/users")
    suspend fun getUsers(): Response<List<ServerUserDto>>

    @GET("api/v1/profiles")
    suspend fun getProfiles(): Response<List<ServerDeviceProfileDto>>

    @POST("api/v1/profiles")
    suspend fun createProfile(
        @Body request: CreateProfileRequestDto
    ): Response<ServerDeviceProfileDto>

    @GET("api/v1/devices")
    suspend fun getDevices(): Response<List<ServerDeviceBundleDto>>

    @POST("api/v1/admin/devices/activate")
    suspend fun activateDevice(
        @Body request: ActivateDeviceRequestDto
    ): Response<ActivateDeviceResponseDto>

    @POST("api/v1/admin/devices/{deviceId}/send-activation-sms")
    suspend fun sendActivationSms(
        @Path("deviceId") deviceId: String,
        @Body request: SendActivationSmsRequestDto = SendActivationSmsRequestDto()
    ): Response<SendActivationSmsResponseDto>

    @PATCH("api/v1/devices/{deviceId}")
    suspend fun updateVehicleMetadata(
        @Path("deviceId") deviceId: String,
        @Body request: UpdateVehicleMetadataRequestDto
    ): Response<ServerDeviceBundleDto>

    @POST("api/v1/admin/devices/{deviceId}/override-activate")
    suspend fun adminOverrideActivation(
        @Path("deviceId") deviceId: String,
        @Body request: AdminOverrideRequestDto
    ): Response<Map<String, Any?>>

    @POST("api/v1/admin/devices/{deviceId}/reassign")
    suspend fun reassignDeviceCustomer(
        @Path("deviceId") deviceId: String,
        @Body request: ReassignCustomerRequestDto
    ): Response<Map<String, Any?>>

    @POST("api/v1/admin/devices/{deviceId}/renew")
    suspend fun renewSubscription(
        @Path("deviceId") deviceId: String,
        @Body request: RenewSubscriptionRequestDto
    ): Response<Map<String, Any?>>

    @POST("api/v1/admin/devices/{deviceId}/suspend")
    suspend fun suspendSubscription(
        @Path("deviceId") deviceId: String,
        @Body request: ReasonRequestDto
    ): Response<Map<String, Any?>>

    @POST("api/v1/admin/devices/{deviceId}/resume")
    suspend fun resumeSubscription(
        @Path("deviceId") deviceId: String,
        @Body request: ReasonRequestDto
    ): Response<Map<String, Any?>>

    @POST("api/v1/devices/{deviceId}/commands")
    suspend fun sendDeviceCommand(
        @Path("deviceId") deviceId: String,
        @Body request: SendDeviceCommandRequestDto
    ): Response<ServerDeviceCommandDto>

    @GET("api/v1/devices/{deviceId}/history")
    suspend fun getDeviceRouteHistory(
        @Path("deviceId") deviceId: String,
        @Query("from") fromIso8601: String,
        @Query("to") toIso8601: String
    ): Response<List<ServerRoutePointDto>>

    @GET("api/v1/events")
    suspend fun getFleetEvents(
        @Query("from") fromIso8601: String,
        @Query("to") toIso8601: String,
        @Query("deviceId") deviceId: String? = null
    ): Response<List<ServerFleetEventDto>>

    @GET("api/v1/reports/summary")
    suspend fun getMileageSummary(
        @Query("from") fromIso8601: String,
        @Query("to") toIso8601: String,
        @Query("deviceId") deviceId: String? = null
    ): Response<List<ServerMileageSummaryDto>>

    @GET("api/v1/telemetry")
    suspend fun getFleetTelemetry(
        @Query("deviceId") deviceId: String? = null
    ): Response<List<ServerFleetTelemetryDto>>

    @GET("api/v1/geofences")
    suspend fun getGeofences(): Response<List<ServerGeofenceDto>>

    @POST("api/v1/geofences")
    suspend fun createGeofence(
        @Body request: CreateGeofenceRequestDto
    ): Response<ServerGeofenceDto>

    @DELETE("api/v1/geofences/{geofenceId}")
    suspend fun deleteGeofence(
        @Path("geofenceId") geofenceId: Long
    ): Response<DeleteGeofenceResponseDto>

    @POST("api/v1/devices/{deviceId}/share")
    suspend fun createDeviceShare(
        @Path("deviceId") deviceId: String,
        @Body request: CreateDeviceShareRequestDto
    ): Response<ServerDeviceShareResponseDto>

    @POST("api/v1/system/check-update")
    suspend fun checkSystemUpdate(
        @Body request: CheckUpdateRequestDto = CheckUpdateRequestDto()
    ): Response<ServerSystemVersionDto>

    @POST("api/v1/admin/traccar/sync")
    suspend fun triggerTraccarSync(): Response<TraccarSyncResponseDto>
}

data class GitHubReleaseAssetDto(
    val name: String = "",
    val browser_download_url: String = ""
)

data class GitHubReleaseDto(
    val tag_name: String = "",
    val name: String? = null,
    val html_url: String? = null,
    val body: String? = null,
    val published_at: String? = null,
    val assets: List<GitHubReleaseAssetDto> = emptyList()
)

object VeloTrackNetworkClient {
    const val DEFAULT_GITHUB_REPO = "mahmoudhindam9-stack/gps"
    private const val DEFAULT_PUBLIC_HTTPS_API =
        "https://api.velotrack.local/"

    @Volatile
    var bearerToken: String? = null

    @Volatile
    var baseUrl: String = BuildConfig.VELOTRACK_API_BASE_URL.ifBlank { DEFAULT_PUBLIC_HTTPS_API }

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    fun getMoshi(): Moshi = moshi

    fun normalizeBaseUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return DEFAULT_PUBLIC_HTTPS_API
        return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    }

    /**
     * Builds an OkHttpClient that:
     * 1. Attaches only a verified server-issued Bearer JWT token (never fake role headers).
     * 2. Supports HTTP 206 Range requests & disk byte-range caching for self-hosted PMTiles.
     */
    fun createOkHttpClient(context: Context? = null): OkHttpClient {
        val builder = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)

        if (context != null) {
            val tileCacheDir = File(context.cacheDir, "velotrack_pmtiles_range_cache")
            builder.cache(Cache(tileCacheDir, 64L * 1024L * 1024L))
        }

        val authAndRangeInterceptor = Interceptor { chain ->
            val original = chain.request()
            val reqBuilder = original.newBuilder()
                .header("Accept", "application/json")
            val token = bearerToken
            if (!token.isNullOrBlank()) {
                reqBuilder.header("Authorization", "Bearer $token")
            }
            if (original.url.encodedPath.endsWith(".pmtiles")) {
                reqBuilder.header("Accept-Ranges", "bytes")
            }
            chain.proceed(reqBuilder.build())
        }

        return builder
            .addInterceptor(authAndRangeInterceptor)
            .build()
    }

    fun createApiService(
        context: Context? = null,
        overrideBaseUrl: String? = null
    ): VeloTrackApiService {
        val resolvedUrl = normalizeBaseUrl(overrideBaseUrl ?: baseUrl)
        return Retrofit.Builder()
            .baseUrl(resolvedUrl)
            .client(createOkHttpClient(context))
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(VeloTrackApiService::class.java)
    }

    fun openLiveWebSocket(
        context: Context? = null,
        listener: WebSocketListener
    ): WebSocket? {
        val token = bearerToken ?: return null
        val httpUrl = normalizeBaseUrl(baseUrl)
        val wsUrl = httpUrl
            .replaceFirst("^https://".toRegex(), "wss://")
            .replaceFirst("^http://".toRegex(), "ws://") + "ws/live"
        val request = Request.Builder()
            .url(wsUrl)
            .header("Authorization", "Bearer $token")
            .build()
        return createOkHttpClient(context).newWebSocket(request, listener)
    }

    fun fetchLatestGitHubRelease(repo: String = DEFAULT_GITHUB_REPO): GitHubReleaseDto? {
        val client = OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .build()
        val adapter = moshi.adapter(GitHubReleaseDto::class.java)
        val latestReq = Request.Builder()
            .url("https://api.github.com/repos/$repo/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "VeloTrack-Android/${BuildConfig.VERSION_NAME}")
            .build()

        runCatching {
            client.newCall(latestReq).execute().use { res ->
                if (res.isSuccessful) {
                    val body = res.body?.string()
                    if (!body.isNullOrBlank()) {
                        return adapter.fromJson(body)
                    }
                }
            }
        }
        return null
    }
}
