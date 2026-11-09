package com.example.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "users_profile")
data class UserProfileEntity(
    @PrimaryKey val id: String,
    val email: String,
    val phone: String,
    val fullName: String,
    val role: String, // ADMIN or CUSTOMER
    val isActive: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)

/**
 * Versioned GPS Device Server Activation Profile Registry.
 * Strictly excludes APN configuration (SIMs auto-configure APN on power-up).
 * Automatic activation never modifies TIMER settings; TIMER is strictly optional/manual.
 */
@Entity(tableName = "device_profiles")
data class DeviceProfileEntity(
    @PrimaryKey val id: String,
    val manufacturer: String,
    val model: String,
    val firmwareVersion: String,
    val traccarProtocol: String, // e.g., "gt06"
    val serverHost: String,      // e.g., "gps.velotrack.eg" or "197.55.128.42"
    val serverPort: Int,         // e.g., 5023 for GT06N
    val transport: String,       // "TCP" or "UDP"
    val serverMode: String,      // "DOMAIN" or "IP"
    val requiresDevicePassword: Boolean,
    val defaultDevicePassword: String?,
    val requiresGprsonCommand: Boolean,
    val serverCommandTemplate: String, // e.g. "SERVER,1,{host},{port},0#"
    val gprsonCommandTemplate: String?, // e.g. "GPRSON,1#" when verified & required
    val optionalTimerCommandTemplate: String?, // Optional manual command only, never sent automatically
    val expectedReplyPattern: String?, // Configurable regex/substring per firmware, nullable
    val isVerified: Boolean,
    val verificationNotes: String
)

@Entity(
    tableName = "devices",
    indices = [Index(value = ["imei"], unique = true), Index(value = ["currentCustomerId"])]
)
data class DeviceEntity(
    @PrimaryKey val id: String,
    val imei: String,
    val traccarDeviceId: Long,
    val profileId: String,
    val currentCustomerId: String,
    val vehicleName: String,
    val plateNumber: String,
    val simLocalNumber: String, // Entered without +20 (e.g. 01012345678)
    val simE164Number: String,  // Normalized by backend (+201012345678)
    val activationStatus: String, // PENDING, SMS_SENT, WAITING_FOR_DEVICE, ACTIVATED, FAILED
    val connectionState: String,  // ONLINE_GPS_FIX, ONLINE_NO_FIX, OFFLINE
    val lastLat: Double,
    val lastLng: Double,
    val lastSpeedKmh: Float,
    val lastHeading: Float,
    val ignitionOn: Boolean,
    val firstConnectedAt: Long?,
    val lastSeenAt: Long?,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "activation_sms_logs",
    indices = [Index(value = ["deviceId"])]
)
data class ActivationSmsLogEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val stepOrder: Int,
    val commandKey: String, // SERVER, GPRSON, OPTIONAL_TIMER
    val commandText: String,
    val gatewayMessageId: String,
    val status: String, // QUEUED, SENT, DELIVERED, REPLIED, FAILED, TIMED_OUT
    val deviceReply: String?,
    val sentAt: Long,
    val completedAt: Long?
)

@Entity(
    tableName = "subscriptions",
    indices = [Index(value = ["deviceId"], unique = true), Index(value = ["customerId"])]
)
data class SubscriptionEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val customerId: String,
    val planDuration: String, // MONTH_1, MONTH_3, MONTH_6, MONTH_12, LIFETIME
    val status: String,       // AWAITING_FIRST_CONNECTION, ACTIVE, EXPIRED, SUSPENDED
    val startedAt: Long?,     // Null until first confirmed Traccar connection or Admin Override
    val expiresAt: Long?,     // Null until first connection or LIFETIME
    val adminOverrideBy: String?,
    val adminOverrideReason: String?
)

@Entity(
    tableName = "subscription_history",
    indices = [Index(value = ["deviceId"])]
)
data class SubscriptionHistoryEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val customerId: String,
    val actionType: String, // PROVISIONED, STARTED_ON_1ST_CONNECTION, RENEWED, ADMIN_OVERRIDE, EXPIRED
    val planDuration: String,
    val notes: String,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "device_ownership_history",
    indices = [Index(value = ["deviceId"])]
)
data class DeviceOwnershipHistoryEntity(
    @PrimaryKey val id: String,
    val deviceId: String,
    val previousCustomerId: String?,
    val previousCustomerName: String?,
    val newCustomerId: String,
    val newCustomerName: String,
    val reassignedByAdminId: String,
    val reason: String,
    val reassignedAt: Long = System.currentTimeMillis()
)

/**
 * Local offline route playback cache for Android when viewing historical routes
 * fetched on-demand from Traccar (traccar_db remains the single source of truth on the server).
 */
@Entity(
    tableName = "cached_waypoints",
    indices = [Index(value = ["deviceId", "recordedAt"])]
)
data class CachedWaypointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Float,
    val heading: Float,
    val ignition: Boolean,
    val addressLabel: String,
    val recordedAt: Long
)
