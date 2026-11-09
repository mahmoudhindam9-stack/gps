package com.example.data.model

import com.example.data.local.ActivationSmsLogEntity
import com.example.data.local.DeviceEntity
import com.example.data.local.DeviceOwnershipHistoryEntity
import com.example.data.local.DeviceProfileEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.local.SubscriptionHistoryEntity
import com.example.data.local.UserProfileEntity

enum class UserRole(val shortLabel: String) {
    ADMIN("ADMIN"),
    CUSTOMER("CUSTOMER")
}

enum class ActivationStatus(val shortLabel: String, val stepIndex: Int) {
    PENDING("PENDING", 1),
    SMS_SENT("SMS SENT", 2),
    WAITING_FOR_DEVICE("WAITING FOR DEVICE", 3),
    ACTIVATED("ACTIVATED", 4),
    FAILED("FAILED", 4)
}

enum class DeviceConnectionState(val shortLabel: String) {
    ONLINE_GPS_FIX("ONLINE • GPS FIX"),
    ONLINE_NO_FIX("ONLINE • NO GPS FIX"),
    OFFLINE("OFFLINE")
}

enum class PlanDuration(
    val shortLabel: String,
    val fullLabel: String,
    val durationDays: Int?
) {
    MONTH_1("1M", "1 Month", 30),
    MONTH_3("3M", "3 Months", 90),
    MONTH_6("6M", "6 Months", 180),
    MONTH_12("12M", "12 Months", 365),
    LIFETIME("Lifetime", "Lifetime", null);

    fun computeExpiryMillis(startMillis: Long): Long? {
        val days = durationDays ?: return null
        return startMillis + (days.toLong() * 24L * 60L * 60L * 1000L)
    }
}

enum class SubscriptionStatus(val shortLabel: String) {
    AWAITING_FIRST_CONNECTION("AWAITING 1ST CONNECTION"),
    ACTIVE("ACTIVE"),
    EXPIRED("EXPIRED"),
    SUSPENDED("SUSPENDED")
}

enum class ServerConfigMode(val code: Int, val shortLabel: String) {
    DOMAIN(1, "DNS"),
    IP(0, "IP")
}

enum class TransportProtocol(val gt06Code: Int, val shortLabel: String) {
    TCP(0, "TCP"),
    UDP(1, "UDP")
}

enum class SmsStepStatus(val shortLabel: String) {
    QUEUED("QUEUED"),
    SENT("SENT"),
    DELIVERED("DELIVERED"),
    REPLIED("REPLIED"),
    FAILED("FAILED"),
    TIMED_OUT("TIMEOUT")
}

data class DeviceAggregate(
    val device: DeviceEntity,
    val profile: DeviceProfileEntity,
    val customer: UserProfileEntity,
    val subscription: SubscriptionEntity,
    val smsLogs: List<ActivationSmsLogEntity>,
    val subscriptionHistory: List<SubscriptionHistoryEntity>,
    val ownershipHistory: List<DeviceOwnershipHistoryEntity>
) {
    fun isSubscriptionAccessible(nowMillis: Long = System.currentTimeMillis()): Boolean {
        if (subscription.status != SubscriptionStatus.ACTIVE.name) return false
        if (subscription.planDuration == PlanDuration.LIFETIME.name) return true
        val expiry = subscription.expiresAt ?: return false
        return expiry > nowMillis
    }

    fun remainingDaysText(nowMillis: Long = System.currentTimeMillis()): String {
        if (subscription.status == SubscriptionStatus.AWAITING_FIRST_CONNECTION.name) {
            return "Starts on 1st connection (${PlanDuration.valueOf(subscription.planDuration).shortLabel})"
        }
        if (subscription.status == SubscriptionStatus.SUSPENDED.name) {
            return "Suspended"
        }
        if (subscription.planDuration == PlanDuration.LIFETIME.name && subscription.status == SubscriptionStatus.ACTIVE.name) {
            return "Lifetime • Active"
        }
        val expiry = subscription.expiresAt ?: return "Expired"
        val diffMs = expiry - nowMillis
        if (diffMs <= 0L) return "Expired"
        val seconds = diffMs / 1000L
        if (seconds < 120L) return "Expires in ${seconds}s"
        val days = diffMs / (24L * 60L * 60L * 1000L)
        return if (days == 0L) {
            val hours = (diffMs / (60L * 60L * 1000L)).coerceAtLeast(1L)
            "${hours}h left"
        } else {
            "${days}d left"
        }
    }
}

data class NormalizedEgyptianSim(
    val isValid: Boolean,
    val localNumber: String,
    val e164Number: String,
    val errorReason: String? = null
)

object SimAndImeiValidator {
    /**
     * Validates an Egyptian SIM number entered WITHOUT the +20 country code.
     * Valid inputs: 010XXXXXXXX, 011XXXXXXXX, 012XXXXXXXX, 015XXXXXXXX (11 digits)
     * or 10XXXXXXXX, 11XXXXXXXX, 12XXXXXXXX, 15XXXXXXXX (10 digits).
     */
    fun normalizeEgyptianSim(rawInput: String): NormalizedEgyptianSim {
        val trimmed = rawInput.trim().replace(" ", "").replace("-", "")
        if (trimmed.isEmpty()) {
            return NormalizedEgyptianSim(false, "", "", "Enter SIM number without +20")
        }
        if (trimmed.startsWith("+20") || trimmed.startsWith("0020")) {
            return NormalizedEgyptianSim(
                isValid = false,
                localNumber = trimmed,
                e164Number = "",
                errorReason = "Enter local number without +20 (e.g. 01012345678)"
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
                errorReason = "Must be 10 or 11 digits (010/011/012/015...)"
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
                errorReason = "Prefix must be 010, 011, 012, or 015"
            )
        }
        return NormalizedEgyptianSim(
            isValid = true,
            localNumber = "0$normalizedTen",
            e164Number = "+20$normalizedTen",
            errorReason = null
        )
    }

    /**
     * Validates a 15-digit GPS tracker IMEI with Luhn check.
     */
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

    fun generateValidGt06nImei(seed: Long = System.nanoTime()): String {
        val tac = "35873905" // Concox GT06N TAC prefix
        val serial = ((seed.coerceAtLeast(0L) % 900000L) + 100000L).toString().take(6)
        val first14 = tac + serial
        val check = computeLuhnCheckDigit(first14)
        return "$first14$check"
    }
}
