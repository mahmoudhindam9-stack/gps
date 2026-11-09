package com.example

import com.example.data.local.DeviceEntity
import com.example.data.local.SubscriptionEntity
import com.example.data.model.ActivationStatus
import com.example.data.model.DeviceConnectionState
import com.example.data.model.PlanDuration
import com.example.data.model.ReconnectPolicy
import com.example.data.model.SimAndImeiValidator
import com.example.data.model.SubscriptionStatus
import com.example.data.network.TraccarDeviceDto
import com.example.data.network.TraccarPositionDto
import com.example.data.repository.TraccarProtocolCorrelator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExampleUnitTest {

    @Test
    fun egyptianSimValidator_rejectsCountryCodeAndNormalizesLocalNumbers() {
        val withCountryCode = SimAndImeiValidator.normalizeEgyptianSim("+201012345678")
        assertFalse(withCountryCode.isValid)

        val withZeroZeroCountryCode = SimAndImeiValidator.normalizeEgyptianSim("00201012345678")
        assertFalse(withZeroZeroCountryCode.isValid)

        val valid11Digit = SimAndImeiValidator.normalizeEgyptianSim("01012345678")
        assertTrue(valid11Digit.isValid)
        assertEquals("01012345678", valid11Digit.localNumber)
        assertEquals("+201012345678", valid11Digit.e164Number)

        val valid10Digit = SimAndImeiValidator.normalizeEgyptianSim("1287654321")
        assertTrue(valid10Digit.isValid)
        assertEquals("01287654321", valid10Digit.localNumber)
        assertEquals("+201287654321", valid10Digit.e164Number)
    }

    @Test
    fun imeiLuhnValidator_validatesReal15DigitImeiAndRejectsInvalidChecksums() {
        assertTrue(SimAndImeiValidator.isValidImei("358739051122332"))
        assertFalse(SimAndImeiValidator.isValidImei("358739051122330"))
        assertFalse(SimAndImeiValidator.isValidImei("35873905112233"))
    }

    @Test
    fun planDuration_computesExactExpiryAndLifetimeNull() {
        val start = 1_700_000_000_000L
        val oneMonthExpiry = PlanDuration.MONTH_1.computeExpiryMillis(start)
        assertEquals(start + 30L * 86_400_000L, oneMonthExpiry)
        assertNull(PlanDuration.LIFETIME.computeExpiryMillis(start))
    }

    @Test
    fun traccarSessionCookieAndSocketFrameParsing_extractsCookieAndNormalizesFrames() {
        val cookie = TraccarProtocolCorrelator.extractSessionCookie(
            listOf("JSESSIONID=real_traccar_session_abc123; Path=/; HttpOnly")
        )
        assertEquals("JSESSIONID=real_traccar_session_abc123", cookie)
        assertNull(TraccarProtocolCorrelator.extractSessionCookie(listOf("OTHER=123")))

        val frameJson = """
            {
              "devices": [
                {
                  "id": 42,
                  "name": "Concox Unit 1",
                  "uniqueId": "358739051122332",
                  "status": "online",
                  "lastUpdate": "2026-04-08T10:15:30Z"
                }
              ],
              "positions": [
                {
                  "id": 9001,
                  "deviceId": 42,
                  "fixTime": "2026-04-08T10:15:30Z",
                  "valid": true,
                  "latitude": 30.0561,
                  "longitude": 31.2394,
                  "speed": 20.0,
                  "course": 180.0,
                  "attributes": {
                    "ignition": true,
                    "sat": 9,
                    "rssi": 4
                  }
                }
              ]
            }
        """.trimIndent()

        val parsed = TraccarProtocolCorrelator.parseTraccarSocketFrame(frameJson)
        assertNotNull(parsed)
        val devices = parsed!!.devices.orEmpty()
        val positions = parsed.positions.orEmpty()
        assertEquals(1, devices.size)
        assertEquals("358739051122332", devices.first().uniqueId)
        assertEquals(1, positions.size)
        assertEquals(37.04f, TraccarProtocolCorrelator.knotsToKmh(positions.first().speed), 0.02f)
    }

    @Test
    fun reconnectBackoff_isBoundedExponentially() {
        assertEquals(1_000L, ReconnectPolicy.computeBackoffMillis(0))
        assertEquals(2_000L, ReconnectPolicy.computeBackoffMillis(1))
        assertEquals(4_000L, ReconnectPolicy.computeBackoffMillis(2))
        assertEquals(30_000L, ReconnectPolicy.computeBackoffMillis(10))
    }

    @Test
    fun imeiCorrelation_handlesIndoorLoginWithoutFixAndStartsSubscriptionOnce() {
        val initialDevice = DeviceEntity(
            id = "dev-1",
            imei = "358739051122332",
            traccarDeviceId = 77L,
            profileId = "profile-gt06n",
            currentCustomerId = "cust-1",
            vehicleName = "Fleet Truck 01",
            plateNumber = "ABC-123",
            simLocalNumber = "01012345678",
            simE164Number = "+201012345678",
            activationStatus = ActivationStatus.WAITING_FOR_DEVICE.name,
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
        val initialSub = SubscriptionEntity(
            id = "sub-1",
            deviceId = "dev-1",
            customerId = "cust-1",
            planDuration = PlanDuration.MONTH_3.name,
            status = SubscriptionStatus.AWAITING_FIRST_CONNECTION.name,
            startedAt = null,
            expiresAt = null,
            adminOverrideBy = null,
            adminOverrideReason = null
        )

        val firstConnectMillis = 1_710_000_000_000L
        val (indoorDevice, startedSub) = TraccarProtocolCorrelator.applyTraccarEventToDevice(
            device = initialDevice,
            subscription = initialSub,
            traccarDevice = TraccarDeviceDto(
                id = 77L,
                name = "Fleet Truck 01",
                uniqueId = "358739051122332",
                status = "online"
            ),
            traccarPosition = TraccarPositionDto(
                id = 500L,
                deviceId = 77L,
                valid = false,
                latitude = 0.0,
                longitude = 0.0,
                speed = 0.0
            ),
            eventTimestampMs = firstConnectMillis
        )

        assertEquals(ActivationStatus.ACTIVATED.name, indoorDevice.activationStatus)
        assertEquals(DeviceConnectionState.ONLINE_NO_FIX.name, indoorDevice.connectionState)
        assertNull(indoorDevice.lastLat)
        assertNull(indoorDevice.lastLng)
        assertFalse(indoorDevice.hasValidFix)

        assertEquals(SubscriptionStatus.ACTIVE.name, startedSub.status)
        assertEquals(firstConnectMillis, startedSub.startedAt)
        assertEquals(PlanDuration.MONTH_3.computeExpiryMillis(firstConnectMillis), startedSub.expiresAt)

        // Second packet with valid GPS fix must NOT reset subscription startedAt
        val secondPacketMillis = firstConnectMillis + 60_000L
        val (outdoorDevice, subsequentSub) = TraccarProtocolCorrelator.applyTraccarEventToDevice(
            device = indoorDevice,
            subscription = startedSub,
            traccarDevice = TraccarDeviceDto(
                id = 77L,
                name = "Fleet Truck 01",
                uniqueId = "358739051122332",
                status = "online"
            ),
            traccarPosition = TraccarPositionDto(
                id = 501L,
                deviceId = 77L,
                valid = true,
                latitude = 30.0561,
                longitude = 31.2394,
                speed = 10.0
            ),
            eventTimestampMs = secondPacketMillis
        )

        assertEquals(DeviceConnectionState.ONLINE_GPS_FIX.name, outdoorDevice.connectionState)
        assertTrue(outdoorDevice.hasValidFix)
        assertEquals(30.0561, outdoorDevice.lastLat!!, 0.0001)
        assertEquals(31.2394, outdoorDevice.lastLng!!, 0.0001)
        assertEquals(firstConnectMillis, subsequentSub.startedAt)
    }
}
