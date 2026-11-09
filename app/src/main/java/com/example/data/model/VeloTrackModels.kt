package com.example.data.model

import com.example.data.local.ActivationSmsLogEntity
import com.example.data.local.DeviceEntity
import com.example.data.local.DeviceOwnershipHistoryEntity
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.local.SubscriptionHistoryEntity
import com.example.data.local.UserProfileEntity
import kotlin.math.min
import kotlin.math.pow

enum class UserRole(val shortLabel: String) {
    ADMIN("ADMIN"),
    CUSTOMER("CUSTOMER")
}

enum class ActivationStatus(val shortLabel: String, val stepIndex: Int) {
    PENDING("PENDING", 1),
    SMS_SENT("SMS SENT", 2),
    WAITING_FOR_DEVICE("WAITING", 3),
    ACTIVATED("ACTIVATED", 4),
    FAILED("FAILED", 4)
}

enum class DeviceConnectionState(val shortLabel: String) {
    ONLINE_GPS_FIX("ONLINE"),
    ONLINE_NO_FIX("NO FIX"),
    OFFLINE("OFFLINE")
}

enum class PlanDuration(
    val shortLabel: String,
    val durationDays: Int?
) {
    MONTH_1("1M", 30),
    MONTH_3("3M", 90),
    MONTH_6("6M", 180),
    MONTH_12("12M", 365),
    LIFETIME("Lifetime", null);

    fun computeExpiryMillis(startMillis: Long): Long? {
        val days = durationDays ?: return null
        return startMillis + (days.toLong() * 24L * 60L * 60L * 1000L)
    }
}

enum class SubscriptionStatus(val shortLabel: String) {
    AWAITING_FIRST_CONNECTION("WAITING"),
    ACTIVE("ACTIVE"),
    EXPIRED("EXPIRED"),
    SUSPENDED("SUSPENDED")
}

enum class SmsStepStatus(val shortLabel: String) {
    QUEUED("QUEUED"),
    ACCEPTED("ACCEPTED"),
    SENT("SENT"),
    DELIVERED("DELIVERED"),
    REPLIED("REPLIED"),
    FAILED("FAILED"),
    TIMED_OUT("TIMEOUT")
}

enum class BackendConnectionState(val shortLabel: String) {
    DISCONNECTED("DISCONNECTED"),
    CONNECTING("CONNECTING"),
    CONNECTED("CONNECTED"),
    RECONNECTING("RECONNECTING"),
    UNAUTHORIZED("UNAUTHORIZED")
}

data class AuthenticatedSession(
    val token: String,
    val userId: String,
    val email: String,
    val fullName: String,
    val role: UserRole
)

data class DeviceAggregate(
    val device: DeviceEntity,
    val profile: DeviceProfileEntity?,
    val customer: UserProfileEntity?,
    val subscription: SubscriptionEntity,
    val smsLogs: List<ActivationSmsLogEntity>,
    val subscriptionHistory: List<SubscriptionHistoryEntity>,
    val ownershipHistory: List<DeviceOwnershipHistoryEntity>
) {
    fun isSubscriptionAccessible(serverNowMillis: Long = System.currentTimeMillis()): Boolean {
        if (subscription.status != SubscriptionStatus.ACTIVE.name) return false
        if (subscription.planDuration == PlanDuration.LIFETIME.name) return true
        val expiry = subscription.expiresAt ?: return false
        return expiry > serverNowMillis
    }

    fun compactSubscriptionBadge(serverNowMillis: Long = System.currentTimeMillis()): String {
        val planLabel = runCatching { PlanDuration.valueOf(subscription.planDuration).shortLabel }
            .getOrDefault(subscription.planDuration)
        if (subscription.status == SubscriptionStatus.AWAITING_FIRST_CONNECTION.name) {
            return "$planLabel • WAITING"
        }
        if (subscription.status == SubscriptionStatus.SUSPENDED.name) {
            return "SUSPENDED"
        }
        if (subscription.status == SubscriptionStatus.EXPIRED.name) {
            return "EXPIRED"
        }
        if (subscription.planDuration == PlanDuration.LIFETIME.name) {
            return "LIFETIME"
        }
        val expiry = subscription.expiresAt ?: return "EXPIRED"
        val diffMs = expiry - serverNowMillis
        if (diffMs <= 0L) return "EXPIRED"
        val days = (diffMs / 86_400_000L).coerceAtLeast(1L)
        return "$planLabel • ${days}d"
    }
}

data class NormalizedEgyptianSim(
    val isValid: Boolean,
    val localNumber: String,
    val e164Number: String,
    val errorReason: String? = null
)

object SimAndImeiValidator {
    fun normalizeEgyptianSim(rawInput: String): NormalizedEgyptianSim {
        val trimmed = rawInput.trim().replace(" ", "").replace("-", "")
        if (trimmed.isEmpty()) {
            return NormalizedEgyptianSim(false, "", "", "SIM required")
        }
        if (trimmed.startsWith("+20") || trimmed.startsWith("0020")) {
            return NormalizedEgyptianSim(
                isValid = false,
                localNumber = trimmed,
                e164Number = "",
                errorReason = "Omit +20"
            )
        }
        if (!trimmed.all { it.isDigit() }) {
            return NormalizedEgyptianSim(false, trimmed, "", "Digits only")
        }
        val normalizedTen = when {
            trimmed.length == 11 && trimmed.startsWith("0") -> trimmed.substring(1)
            trimmed.length == 10 -> trimmed
            else -> return NormalizedEgyptianSim(
                isValid = false,
                localNumber = trimmed,
                e164Number = "",
                errorReason = "10 or 11 digits"
            )
        }
        val validPrefix = normalizedTen.startsWith("10") ||
            normalizedTen.startsWith("11") ||
            normalizedTen.startsWith("12") ||
            normalizedTen.startsWith("15")
        if (!validPrefix) {
            return NormalizedEgyptianSim(
                isValid = false,
                localNumber = "0$normalizedTen",
                e164Number = "",
                errorReason = "Invalid prefix"
            )
        }
        return NormalizedEgyptianSim(
            isValid = true,
            localNumber = "0$normalizedTen",
            e164Number = "+20$normalizedTen",
            errorReason = null
        )
    }

    fun isValidImei(imei: String): Boolean {
        val clean = imei.trim()
        if (clean.length != 15 || !clean.all { it.isDigit() }) return false
        return computeLuhnCheckDigit(clean.substring(0, 14)) == clean[14].digitToInt()
    }

    fun computeLuhnCheckDigit(first14Digits: String): Int {
        var sum = 0
        for (i in 0 until 14) {
            var digit = first14Digits[i].digitToInt()
            if (i % 2 == 1) {
                digit *= 2
                if (digit > 9) digit -= 9
            }
            sum += digit
        }
        return (10 - (sum % 10)) % 10
    }
}

object ReconnectPolicy {
    private const val BASE_DELAY_MS = 1_000L
    private const val MAX_DELAY_MS = 30_000L

    fun computeBackoffMillis(attempt: Int): Long {
        val clampedAttempt = attempt.coerceIn(0, 6)
        val raw = (BASE_DELAY_MS * 2.0.pow(clampedAttempt.toDouble())).toLong()
        return min(MAX_DELAY_MS, raw)
    }
}
