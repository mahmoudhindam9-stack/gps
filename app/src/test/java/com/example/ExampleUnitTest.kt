package com.example

import com.example.data.model.PlanDuration
import com.example.data.model.SimAndImeiValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExampleUnitTest {
    @Test
    fun egyptianSimValidator_rejectsCountryCodeAndNormalizesLocalNumbers() {
        val withCountryCode = SimAndImeiValidator.normalizeEgyptianSim("+201012345678")
        assertFalse(withCountryCode.isValid)

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
    fun imeiLuhnValidator_validatesGeneratedGt06nImeis() {
        val generated = SimAndImeiValidator.generateValidGt06nImei(123456L)
        assertEquals(15, generated.length)
        assertTrue(SimAndImeiValidator.isValidImei(generated))
        assertFalse(SimAndImeiValidator.isValidImei("358739051122330"))
    }

    @Test
    fun planDuration_computesExactExpiryAndLifetimeNull() {
        val start = 1_700_000_000_000L
        val oneMonthExpiry = PlanDuration.MONTH_1.computeExpiryMillis(start)
        assertEquals(start + 30L * 86_400_000L, oneMonthExpiry)
        assertNull(PlanDuration.LIFETIME.computeExpiryMillis(start))
    }
}
