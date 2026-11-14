package com.kyro.classdesk.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AcademicInputValidationTest {
    @Test
    fun acceptsIsoInstant() {
        assertEquals("2026-11-14T10:30:00Z", normalizeCalendarDate("2026-11-14T10:30:00Z"))
    }

    @Test
    fun convertsOffsetDateTimeToUtc() {
        assertEquals("2026-11-14T09:30:00Z", normalizeCalendarDate("2026-11-14T10:30:00+01:00"))
    }

    @Test
    fun convertsPlainDateToStartOfUtcDay() {
        assertEquals("2026-11-14T00:00:00Z", normalizeCalendarDate("2026-11-14"))
    }

    @Test
    fun trimsInputBeforeParsing() {
        assertEquals("2026-11-14T00:00:00Z", normalizeCalendarDate(" 2026-11-14 "))
    }

    @Test
    fun rejectsInvalidOrEmptyDates() {
        assertNull(normalizeCalendarDate("not-a-date"))
        assertNull(normalizeCalendarDate("   "))
    }
}
