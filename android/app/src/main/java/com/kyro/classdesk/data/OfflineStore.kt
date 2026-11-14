package com.kyro.classdesk.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class PendingMutation(
    val id: String,
    val entityId: String,
    val operation: String,
    val baseVersion: Int,
    val payloadJson: String
)

class OfflineStore(context: Context) : SQLiteOpenHelper(context, "classdesk-offline.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE pending_mutations (
            id TEXT PRIMARY KEY NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            base_version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            last_error TEXT,
            created_at INTEGER NOT NULL
        )""")
        db.execSQL("CREATE INDEX pending_mutations_status_created ON pending_mutations(status, created_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Schema migrations are additive; never drop queued offline work.
    }

    @Synchronized
    fun enqueue(mutation: PendingMutation) {
        val values = ContentValues().apply {
            put("id", mutation.id)
            put("entity_id", mutation.entityId)
            put("operation", mutation.operation)
            put("base_version", mutation.baseVersion)
            put("payload_json", mutation.payloadJson)
            put("status", "PENDING")
            put("created_at", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("pending_mutations", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun pending(limit: Int = 100): List<PendingMutation> {
        val result = mutableListOf<PendingMutation>()
        readableDatabase.query(
            "pending_mutations",
            arrayOf("id", "entity_id", "operation", "base_version", "payload_json"),
            "status = ?",
            arrayOf("PENDING"),
            null, null, "created_at ASC", limit.toString()
        ).use { cursor ->
            while (cursor.moveToNext()) result += PendingMutation(
                cursor.getString(0), cursor.getString(1), cursor.getString(2),
                cursor.getInt(3), cursor.getString(4)
            )
        }
        return result
    }

    @Synchronized
    fun mark(id: String, status: String, error: String?) {
        val values = ContentValues().apply { put("status", status); put("last_error", error) }
        writableDatabase.update("pending_mutations", values, "id = ?", arrayOf(id))
    }

    @Synchronized
    fun removeApplied(ids: List<String>) {
        if (ids.isEmpty()) return
        writableDatabase.beginTransaction()
        try {
            ids.forEach { writableDatabase.delete("pending_mutations", "id = ?", arrayOf(it)) }
            writableDatabase.setTransactionSuccessful()
        } finally { writableDatabase.endTransaction() }
    }

    fun closeStore() = close()
}
