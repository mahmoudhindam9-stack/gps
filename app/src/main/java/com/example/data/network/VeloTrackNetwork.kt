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
import retrofit2.http.GET
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
    val email: String,
    val phone: String,
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
    val traccarDeviceId: Long,
    val profileId: String,
    val currentCustomerId: String,
    val vehicleName: String,
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

data class ServerDeviceBundleDto(
    val device: ServerDeviceDto,
    val subscription: ServerSubscriptionDto,
    val customer: ServerUserDto? = null,
    val profile: ServerDeviceProfileDto? = null,
    val smsLogs: List<ServerSmsLogDto> = emptyList(),
    val subscriptionHistory: List<ServerSubHistoryDto> = emptyList(),
    val ownershipHistory: List<ServerOwnershipHistoryDto> = emptyList()
)

data class ActivateDeviceRequestDto(
    val profileId: String,
    val imei: String,
    val customerId: String,
    val vehicleName: String,
    val plateNumber: String,
    val planDuration: String,
    val simLocalWithoutPlus20: String
)

data class ActivateDeviceResponseDto(
    val device: ServerDeviceDto,
    val subscription: ServerSubscriptionDto,
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
    val supabaseConnected: Boolean = false,
    val traccarConnected: Boolean = false,
    val traccarWsConnected: Boolean = false,
    val traccarLastSyncAtMs: Long? = null,
    val smsGatewayConfigured: Boolean = false
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

    @GET("api/v1/devices/{deviceId}/history")
    suspend fun getDeviceRouteHistory(
        @Path("deviceId") deviceId: String,
        @Query("from") fromIso8601: String,
        @Query("to") toIso8601: String
    ): Response<List<ServerRoutePointDto>>

    @POST("api/v1/admin/traccar/sync")
    suspend fun triggerTraccarSync(): Response<TraccarSyncResponseDto>
}

object VeloTrackNetworkClient {
    private const val DEFAULT_PUBLIC_HTTPS_API =
        "https://ais-dev-pyvkwycypjqouw4m3akizc-224077296538.europe-west2.run.app/"

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
}
