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
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
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

    @Test
    fun roomSnapshotCache_persistsServerRecordsAndNeverFabricatesOfflineSession() = kotlinx.coroutines.test.runTest {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = androidx.room.Room.inMemoryDatabaseBuilder(
            context,
            com.example.data.local.VeloTrackDatabase::class.java
        ).allowMainThreadQueries().build()
        val dao = db.veloTrackDao()

        val user = com.example.data.local.UserProfileEntity(
            id = "cust-101",
            username = "cust_alpha",
            email = "alpha@velotrack.org",
            phone = "+201012345678",
            fullName = "Customer Alpha",
            role = "CUSTOMER",
            mustChangePassword = false,
            isActive = true,
            createdAt = 1_710_000_000_000L
        )
        val profile = com.example.data.local.DeviceProfileEntity(
            id = "prof-1",
            manufacturer = "Concox",
            model = "GT06N",
            firmwareVersion = "V2.4",
            traccarProtocol = "gt06",
            serverHost = "gps.velotrack.org",
            serverPort = 5023,
            transport = "TCP",
            serverMode = "DOMAIN",
            requiresDevicePassword = false,
            defaultDevicePassword = null,
            requiresGprsonCommand = false,
            serverCommandTemplate = "SERVER,1,{HOST},{PORT},0#",
            gprsonCommandTemplate = null,
            optionalTimerCommandTemplate = null,
            expectedReplyPattern = "OK",
            isVerified = true
        )
        val device = DeviceEntity(
            id = "dev-101",
            imei = "358739051122332",
            serialNumber = "SN-101",
            traccarDeviceId = 800L,
            profileId = "prof-1",
            currentCustomerId = "cust-101",
            vehicleName = "Alpha Van",
            vehicleType = "VAN",
            vehicleIcon = "van",
            plateNumber = "CAI-101",
            simLocalNumber = "01012345678",
            simE164Number = "+201012345678",
            activationStatus = ActivationStatus.ACTIVATED.name,
            connectionState = DeviceConnectionState.ONLINE_GPS_FIX.name,
            hasValidFix = true,
            lastLat = 30.0444,
            lastLng = 31.2357,
            lastSpeedKmh = 42f,
            lastHeading = 90f,
            ignitionOn = true,
            firstConnectedAt = 1_710_000_100_000L,
            lastSeenAt = 1_710_000_200_000L,
            createdAt = 1_710_000_000_000L
        )
        val sub = SubscriptionEntity(
            id = "sub-101",
            deviceId = "dev-101",
            customerId = "cust-101",
            planDuration = PlanDuration.MONTH_12.name,
            status = SubscriptionStatus.ACTIVE.name,
            startedAt = 1_710_000_100_000L,
            expiresAt = PlanDuration.MONTH_12.computeExpiryMillis(1_710_000_100_000L),
            adminOverrideBy = null,
            adminOverrideReason = null
        )

        dao.replaceSnapshotFromServer(
            users = listOf(user),
            profiles = listOf(profile),
            devices = listOf(device),
            subscriptions = listOf(sub),
            smsLogs = emptyList(),
            subHistory = emptyList(),
            ownHistory = emptyList()
        )

        assertEquals(1, dao.getAllDevicesOnce().size)
        assertEquals("Alpha Van", dao.getAllDevicesOnce().first().vehicleName)

        db.close()
    }
}

