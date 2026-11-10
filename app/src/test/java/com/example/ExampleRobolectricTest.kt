package com.example

import com.example.data.local.ActivationSmsLogEntity
import com.example.data.local.DeviceEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceAggregate
import com.example.data.model.DeviceConnectionState
import com.example.data.model.PlanDuration
import com.example.data.model.SmsStepStatus
import com.example.data.model.SubscriptionStatus
import com.example.data.repository.TraccarProtocolCorrelator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExampleRobolectricTest {

    @Test
    fun subscriptionExpirationAndSmsStateTransitions_enforceBusinessRules() {
        val baseDevice = DeviceEntity(
            id = "dev-sms-1",
            imei = "358739051122332",
            serialNumber = "SN-VAN-02",
            traccarDeviceId = 19L,
            profileId = "profile-gt06n",
            currentCustomerId = "cust-1",
            vehicleName = "Delivery Van 02",
            vehicleType = "VAN",
            vehicleIcon = "van",
            plateNumber = "XYZ-987",
            simLocalNumber = "01112345678",
            simE164Number = "+201112345678",
            activationStatus = ActivationStatus.SMS_SENT.name,
            connectionState = DeviceConnectionState.OFFLINE.name,
            hasValidFix = false,
            lastLat = null,
            lastLng = null,
            lastSpeedKmh = null,
            lastHeading = null,
            ignitionOn = null,
            firstConnectedAt = null,
            lastSeenAt = null,
            createdAt = 1_700_000_000_000L
        )
        val awaitingSub = SubscriptionEntity(
            id = "sub-sms-1",
            deviceId = "dev-sms-1",
            customerId = "cust-1",
            planDuration = PlanDuration.MONTH_1.name,
            status = SubscriptionStatus.AWAITING_FIRST_CONNECTION.name,
            startedAt = null,
            expiresAt = null,
            adminOverrideBy = null,
            adminOverrideReason = null
        )
        val smsLog = ActivationSmsLogEntity(
            id = "sms-log-1",
            deviceId = "dev-sms-1",
            stepOrder = 1,
            commandKey = "SERVER",
            commandText = "SERVER,1,gps.example.com,5023,0#",
            gatewayMessageId = "gw-001",
            status = SmsStepStatus.SENT.name,
            deviceReply = null,
            failureReason = null,
            sentAt = 1_700_000_000_000L,
            completedAt = null
        )

        // SMS delivery or reply must move device to WAITING_FOR_DEVICE and NEVER start subscription
        val (deliveredDevice, subAfterDelivery, deliveredLog) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = baseDevice,
            subscription = awaitingSub,
            smsLog = smsLog,
            newSmsStatus = SmsStepStatus.DELIVERED,
            eventTimestampMs = 1_700_000_005_000L
        )
        assertEquals(ActivationStatus.WAITING_FOR_DEVICE.name, deliveredDevice.activationStatus)
        assertEquals(SubscriptionStatus.AWAITING_FIRST_CONNECTION.name, subAfterDelivery.status)
        assertNull(subAfterDelivery.startedAt)
        assertEquals(SmsStepStatus.DELIVERED.name, deliveredLog.status)

        val (repliedDevice, subAfterReply, repliedLog) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = deliveredDevice,
            subscription = subAfterDelivery,
            smsLog = deliveredLog,
            newSmsStatus = SmsStepStatus.REPLIED,
            replyText = "SERVER,OK!",
            eventTimestampMs = 1_700_000_010_000L
        )
        assertEquals(ActivationStatus.WAITING_FOR_DEVICE.name, repliedDevice.activationStatus)
        assertEquals(SubscriptionStatus.AWAITING_FIRST_CONNECTION.name, subAfterReply.status)
        assertEquals("SERVER,OK!", repliedLog.deviceReply)

        val (timedOutDevice, _, _) = TraccarProtocolCorrelator.applySmsGatewayEvent(
            device = repliedDevice,
            subscription = subAfterReply,
            smsLog = repliedLog,
            newSmsStatus = SmsStepStatus.TIMED_OUT,
            failureReason = "Gateway timeout",
            eventTimestampMs = 1_700_000_060_000L
        )
        assertEquals(ActivationStatus.FAILED.name, timedOutDevice.activationStatus)

        // Subscription expiration and suspension must block live & historical access
        val startMillis = 1_700_000_000_000L
        val expiresMillis = PlanDuration.MONTH_1.computeExpiryMillis(startMillis)!!
        val activeSubscription = SubscriptionEntity(
            id = "sub-exp-1",
            deviceId = "dev-sms-1",
            customerId = "cust-1",
            planDuration = PlanDuration.MONTH_1.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = startMillis,
            expiresAt = expiresMillis,
            adminOverrideBy = null,
            adminOverrideReason = null
        )
        val aggregate = DeviceAggregate(
            device = baseDevice,
            profile = null,
            customer = null,
            subscription = activeSubscription,
            smsLogs = emptyList(),
            subscriptionHistory = emptyList(),
            ownershipHistory = emptyList()
        )

        assertTrue(aggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis - 1_000L))
        assertFalse(aggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis))

        val suspendedAggregate = aggregate.copy(
            subscription = activeSubscription.copy(status = SubscriptionStatus.SUSPENDED.name)
        )
        assertFalse(suspendedAggregate.isSubscriptionAccessible(serverNowMillis = expiresMillis - 1_000L))
        assertEquals("SUSPENDED", suspendedAggregate.compactSubscriptionBadge(expiresMillis - 1_000L))
    }
}
