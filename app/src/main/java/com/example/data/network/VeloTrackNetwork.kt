package com.example.data.network

import android.content.Context
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.Cache
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class ActivateDeviceRequestDto(
    val profileId: String,
    val imei: String,
    val customerId: String,
    val vehicleName: String,
    val plateNumber: String,
    val planDuration: String,
    val simLocalNumberWithoutCountryCode: String // e.g., "01012345678" -> normalized to "+201012345678"
)

data class AdminOverrideRequestDto(
    val adminUserId: String,
    val auditReason: String
)

data class ReassignCustomerRequestDto(
    val newCustomerId: String,
    val adminUserId: String,
    val reason: String
)

data class RenewSubscriptionRequestDto(
    val planDuration: String,
    val adminUserId: String
)

data class RemoteDevicePositionDto(
    val deviceId: String,
    val imei: String,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Float,
    val heading: Float,
    val ignitionOn: Boolean,
    val connectionState: String,
    val recordedAt: Long
)

interface VeloTrackApiService {
    @POST("api/v1/admin/devices/activate")
    suspend fun activateDevice(
        @Body request: ActivateDeviceRequestDto
    ): Response<Map<String, Any>>

    @POST("api/v1/admin/devices/{deviceId}/override-activate")
    suspend fun adminOverrideActivation(
        @Path("deviceId") deviceId: String,
        @Body request: AdminOverrideRequestDto
    ): Response<Map<String, Any>>

    @POST("api/v1/admin/devices/{deviceId}/reassign")
    suspend fun reassignDeviceCustomer(
        @Path("deviceId") deviceId: String,
        @Body request: ReassignCustomerRequestDto
    ): Response<Map<String, Any>>

    @POST("api/v1/admin/devices/{deviceId}/renew")
    suspend fun renewSubscription(
        @Path("deviceId") deviceId: String,
        @Body request: RenewSubscriptionRequestDto
    ): Response<Map<String, Any>>

    @GET("api/v1/devices/{deviceId}/history")
    suspend fun getDeviceRouteHistory(
        @Path("deviceId") deviceId: String,
        @Query("from") fromMillis: Long,
        @Query("to") toMillis: Long
    ): Response<List<RemoteDevicePositionDto>>
}

object VeloTrackNetworkClient {
    @Volatile
    var currentUserId: String = "usr_admin_01"

    @Volatile
    var currentUserRole: String = "ADMIN"

    @Volatile
    var baseUrl: String = "https://gps.velotrack.eg/"

    /**
     * Builds an OkHttpClient that:
     * 1. Attaches the Supabase Auth JWT and per-transaction RLS headers (never service_role).
     * 2. Supports HTTP 206 Range requests & disk byte-range caching for self-hosted PMTiles.
     */
    fun createOkHttpClient(context: Context): OkHttpClient {
        val tileCacheDir = File(context.cacheDir, "velotrack_pmtiles_range_cache")
        val cache = Cache(tileCacheDir, 64L * 1024L * 1024L) // 64 MB HTTP 206 byte-range cache

        val rlsAndRangeInterceptor = Interceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()
                .header("Accept", "application/json")
                .header("X-Supabase-RLS-Role", "authenticated")
                .header("X-Supabase-JWT-Sub", currentUserId)
                .header("X-VeloTrack-Role", currentUserRole)
            if (original.url.encodedPath.endsWith(".pmtiles")) {
                builder.header("Accept-Ranges", "bytes")
            }
            chain.proceed(builder.build())
        }

        return OkHttpClient.Builder()
            .cache(cache)
            .addInterceptor(rlsAndRangeInterceptor)
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    fun createApiService(context: Context): VeloTrackApiService {
        val moshi = Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(createOkHttpClient(context))
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(VeloTrackApiService::class.java)
    }
}
