package com.kyro.classdesk.data

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Accepts ISO instants, offset date-times, or plain ISO dates and normalizes them
 * to a UTC instant before sending calendar records to the shared API.
 */
fun normalizeCalendarDate(value: String): String? {
    val input = value.trim()
    if (input.isEmpty()) return null

    return runCatching { Instant.parse(input).toString() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(input).toInstant().toString() }.getOrNull()
        ?: runCatching { LocalDate.parse(input).atStartOfDay(ZoneOffset.UTC).toInstant().toString() }.getOrNull()
}
