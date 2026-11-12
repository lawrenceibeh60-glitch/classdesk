"use client";
import Dexie, { type Table } from "dexie";

export type CachedRecord = {
  id: string;
  type: string;
  title: string;
  content: string;
  status?: string;
  metadata: Record<string, unknown>;
  eventDate?: string | null;
  updatedAt: string;
  version: number;
  syncState: "synced" | "pending";
};
export type OutboxItem = {
  id: string;
  entityType: "record";
  entityId: string;
  operation: "upsert" | "delete";
  baseVersion: number;
  payload: CachedRecord | Record<string, never>;
  createdAt: string;
};
export type CachedAcademicItem = { key: string; resource: string; id: string; payload: Record<string, unknown>; updatedAt: string };
export type AcademicMutation = { id: string; resource: string; method: "POST" | "PATCH" | "DELETE"; payload: Record<string, unknown>; createdAt: string };
export type QueuedAIRequest = { id: string; kind: "chat" | "generate"; prompt: string; history: Array<{ role: "user" | "assistant"; content: string }>; draftKind: string; createdAt: string };
export type QueuedUpload = { id: string; file: Blob; filename: string; mimeType: string; title: string; courseName: string; courseCode: string; topic: string; lectureDate: string; createdAt: string };
type MetaItem = { key: string; value: string };

class ClassDeskDB extends Dexie {
  records!: Table<CachedRecord, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<MetaItem, string>;
  uploads!: Table<QueuedUpload, string>;
  academicItems!: Table<CachedAcademicItem, string>;
  academicQueue!: Table<AcademicMutation, string>;
  aiQueue!: Table<QueuedAIRequest, string>;
  constructor() {
    super("afit-classdesk");
    this.version(1).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt" });
    this.version(2).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt", meta: "key" });
    this.version(3).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt", meta: "key" }).upgrade(async (tx) => {
      await tx.table("records").toCollection().modify((record: CachedRecord) => { if (typeof record.version !== "number") record.version = record.syncState === "pending" ? 0 : 1; });
      await tx.table("outbox").toCollection().modify((mutation: OutboxItem) => { if (typeof mutation.baseVersion !== "number") mutation.baseVersion = mutation.operation === "upsert" ? (mutation.payload as CachedRecord).version || 0 : 0; });
    });
    this.version(4).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt", meta: "key", uploads: "id,createdAt,filename" });
    this.version(5).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt", meta: "key", uploads: "id,createdAt,filename", academicItems: "key,resource,id,updatedAt", academicQueue: "id,resource,method,createdAt" });
    this.version(6).stores({ records: "id,type,updatedAt,syncState", outbox: "id,entityType,entityId,createdAt", meta: "key", uploads: "id,createdAt,filename", academicItems: "key,resource,id,updatedAt", academicQueue: "id,resource,method,createdAt", aiQueue: "id,kind,createdAt" });
  }
}
export const offlineDB = typeof indexedDB === "undefined" ? null : new ClassDeskDB();
