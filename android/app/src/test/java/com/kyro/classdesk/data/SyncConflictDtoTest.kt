package com.kyro.classdesk.data

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SyncConflictDtoTest {
    @Test
    fun parsesServerRecordForCloudVsLocalResolution() {
        val json = """{
            "id": "mutation-1",
            "entityId": "record-1",
            "reason": "A newer server version exists",
            "serverRecord": {
                "id": "record-1",
                "type": "CALENDAR",
                "title": "Updated timetable",
                "content": "Room changed",
                "eventDate": "2026-11-20T09:00:00.000Z",
                "status": "ACTIVE",
                "version": 4
            }
        }"""
        val conflict = Gson().fromJson(json, SyncConflictDto::class.java)
        assertEquals("mutation-1", conflict.id)
        assertEquals("Updated timetable", conflict.serverRecord?.title)
        assertEquals(4, conflict.serverRecord?.version)
    }

    @Test
    fun acceptsConflictWhenCloudRecordWasDeleted() {
        val json = """{"id":"mutation-2","entityId":"record-2","reason":"A newer server version exists","serverRecord":null}"""
        val conflict = Gson().fromJson(json, SyncConflictDto::class.java)
        assertNull(conflict.serverRecord)
    }
}
