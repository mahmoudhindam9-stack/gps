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
    val createdAt: Long
)

@Entity(tableName = "device_profiles")
data class DeviceProfileEntity(
    @PrimaryKey val id: String,
    val manufacturer: String,
    val model: String,
    val firmwareVersion: String,
    val traccarProtocol: String,
    val serverHost: String,
    val serverPort: Int,
    val transport: String,
    val serverMode: String,
    val requiresDevicePassword: Boolean,
    val defaultDevicePassword: String?,
    val requiresGprsonCommand: Boolean,
    val serverCommandTemplate: String,
    val gprsonCommandTemplate: String?,
    val optionalTimerCommandTemplate: String?,
    val expectedReplyPattern: String?,
    val isVerified: Boolean = false
)

@Entity(
    tableName = "devices",
    indices = [
        Index(value = ["imei"], unique = true),
        Index(value = ["traccarDeviceId"], unique = true),
        Index(value = ["currentCustomerId"])
    ]
)
data class DeviceEntity(
    @PrimaryKey val id: String,
    val imei: String,
    val traccarDeviceId: Long,
    val profileId: String,
    val currentCustomerId: String,
    val vehicleName: String,
    val plateNumber: String,
    val simLocalNumber: String,
    val simE164Number: String,
    val activationStatus: String, // PENDING, SMS_SENT, WAITING_FOR_DEVICE, ACTIVATED, FAILED
    val connectionState: String,  // ONLINE_GPS_FIX, ONLINE_NO_FIX, OFFLINE
    val hasValidFix: Boolean = false,
    val lastLat: Double? = null,
    val lastLng: Double? = null,
    val lastSpeedKmh: Float? = null,
    val lastHeading: Float? = null,
    val ignitionOn: Boolean? = null,
    val firstConnectedAt: Long? = null,
    val lastSeenAt: Long? = null,
    val createdAt: Long
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
    val gatewayMessageId: String?,
    val status: String, // QUEUED, ACCEPTED, SENT, DELIVERED, REPLIED, FAILED, TIMED_OUT
    val deviceReply: String?,
    val failureReason: String? = null,
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
    val startedAt: Long?,     // Null until first confirmed Traccar connection or audited Admin Override
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
    val actionType: String,
    val planDuration: String,
    val notes: String,
    val createdAt: Long
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
    val reassignedAt: Long
)

@Entity(
    tableName = "cached_waypoints",
    indices = [Index(value = ["deviceId", "recordedAt"])]
)
data class CachedWaypointEntity(
    @PrimaryKey val id: Long, // Server/Traccar position ID
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val speedKmh: Float,
    val heading: Float,
    val ignition: Boolean,
    val valid: Boolean,
    val recordedAt: Long
)
