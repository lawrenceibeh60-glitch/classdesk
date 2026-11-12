import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, assertSameOrigin } from "@/lib/http";
import { Prisma } from "@prisma/client";
import JSZip from "jszip";
import { storeObject } from "@/lib/storage";
/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = "nodejs";
export const maxDuration = 60;
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const validId = (value: any) => typeof value?.id === "string" && value.id.length > 0 && value.id.length <= 100;
export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireAdmin(); if (denied) return denied;
  const length = Number(req.headers.get("content-length") || 0);
  const isZipRequest = (req.headers.get("content-type") || "").includes("application/zip");
  const maxBackupBytes = isZipRequest ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
  if (length > maxBackupBytes) return NextResponse.json({ error: `Backup file exceeds the ${isZipRequest ? 100 : 25} MB restore limit` }, { status: 413 });
  let backup: any = null;
  let archive: JSZip | null = null;
  if ((req.headers.get("content-type") || "").includes("application/zip")) {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > maxBackupBytes) return NextResponse.json({ error: "Backup file exceeds the restore limit" }, { status: 413 });
    try {
      archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
      const entries = Object.values(archive.files).filter(entry => !entry.dir);
      const expandedBytes = entries.reduce((total, entry) => total + Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0), 0);
      if (entries.length > 10002 || expandedBytes > 250 * 1024 * 1024) return NextResponse.json({ error: "Backup archive expands beyond the allowed size or file-count limit" }, { status: 413 });
      const manifest = archive.file("backup.json");
      if (!manifest) return NextResponse.json({ error: "ZIP backup is missing backup.json" }, { status: 400 });
      backup = JSON.parse(await manifest.async("string"));
    } catch { return NextResponse.json({ error: "Backup archive is invalid or corrupted" }, { status: 400 }); }
  } else {
    const text = await req.text(); if (text.length > maxBackupBytes) return NextResponse.json({ error: "Backup file exceeds the restore limit" }, { status: 413 }); try { backup = JSON.parse(text); } catch { backup = null; }
  }
  if (backup?.format !== "afit-classdesk-backup" || backup?.schemaVersion !== 1 || (backup?.confirmation !== "RESTORE_CLASSDESK_BACKUP" && req.headers.get("x-classdesk-restore-confirmation") !== "RESTORE_CLASSDESK_BACKUP")) {
    return NextResponse.json({ error: "Invalid backup or missing explicit restore confirmation" }, { status: 400 });
  }
  const records = array(backup.records); const documents = array(backup.documents); const announcements = array(backup.announcements);
  const courses = array(backup.courses); const lectures = array(backup.lectures); const assignments = array(backup.assignments);
  const attendance = array(backup.attendance); const concerns = array(backup.concerns);
  const all = [...records, ...documents, ...announcements, ...courses, ...lectures, ...assignments, ...attendance, ...concerns];
  if (all.length > 10000 || all.some((item) => !validId(item))) return NextResponse.json({ error: "Backup contains invalid identifiers or exceeds 10,000 items" }, { status: 400 });
  try {
    await db.$transaction(async (tx) => {
      for (const r of records) await tx.academicRecord.upsert({ where: { id: r.id }, create: { id: r.id, type: r.type, title: r.title, content: r.content || "", metadata: (r.metadata || {}) as Prisma.InputJsonValue, eventDate: r.eventDate ? new Date(r.eventDate) : null, status: r.status || "ACTIVE", version: Number.isInteger(r.version) ? r.version : 1, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) }, update: { type: r.type, title: r.title, content: r.content || "", metadata: (r.metadata || {}) as Prisma.InputJsonValue, eventDate: r.eventDate ? new Date(r.eventDate) : null, status: r.status || "ACTIVE", version: Number.isInteger(r.version) ? r.version : 1 } });
      for (const d of documents) {
        await tx.document.upsert({ where: { id: d.id }, create: { id: d.id, title: d.title, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, storageKey: null, extractedText: d.extractedText || "", courseCode: d.courseCode, courseName: d.courseName, lectureDate: d.lectureDate ? new Date(d.lectureDate) : null, topic: d.topic, status: d.status || "READY", securityScanStatus: d.securityScanStatus || "UNSCANNED", createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) }, update: { title: d.title, filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, extractedText: d.extractedText || "", courseCode: d.courseCode, courseName: d.courseName, lectureDate: d.lectureDate ? new Date(d.lectureDate) : null, topic: d.topic, status: d.status || "READY", securityScanStatus: d.securityScanStatus || "UNSCANNED" } });
        await tx.documentChunk.deleteMany({ where: { documentId: d.id } });
        const chunks = array(d.chunks).filter((c) => typeof c.content === "string").map((c, index) => ({ id: typeof c.id === "string" ? c.id : undefined, documentId: d.id, chunkIndex: Number.isInteger(c.chunkIndex) ? c.chunkIndex : index, content: c.content }));
        if (chunks.length) await tx.documentChunk.createMany({ data: chunks });
      }
      for (const a of announcements) {
        await tx.announcement.upsert({ where: { id: a.id }, create: { id: a.id, title: a.title, body: a.body, category: a.category || "GENERAL", source: a.source, status: a.status || "DRAFT", scheduledFor: a.scheduledFor ? new Date(a.scheduledFor) : null, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) }, update: { title: a.title, body: a.body, category: a.category || "GENERAL", source: a.source, status: a.status || "DRAFT", scheduledFor: a.scheduledFor ? new Date(a.scheduledFor) : null, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null } });
        for (const v of array(a.versions)) await tx.announcementVersion.upsert({ where: { announcementId_version: { announcementId: a.id, version: v.version } }, create: { id: validId(v) ? v.id : undefined, announcementId: a.id, version: v.version, title: v.title, body: v.body, status: v.status, createdAt: new Date(v.createdAt) }, update: { title: v.title, body: v.body, status: v.status } });
        for (const event of array(a.events)) if (typeof event.action === "string") { if (validId(event)) await tx.announcementEvent.upsert({ where: { id: event.id }, create: { id: event.id, announcementId: a.id, action: event.action, details: event.details, createdAt: new Date(event.createdAt) }, update: { action: event.action, details: event.details } }); else await tx.announcementEvent.create({ data: { announcementId: a.id, action: event.action, details: event.details, createdAt: event.createdAt ? new Date(event.createdAt) : new Date() } }); }
      }
      for (const c of courses) await tx.course.upsert({ where: { id: c.id }, create: { id: c.id, code: c.code, name: c.name, lecturer: c.lecturer, semester: c.semester, description: c.description, active: c.active ?? true, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) }, update: { code: c.code, name: c.name, lecturer: c.lecturer, semester: c.semester, description: c.description, active: c.active ?? true } });
      for (const l of lectures) await tx.lectureSession.upsert({ where: { id: l.id }, create: { id: l.id, courseId: l.courseId, topic: l.topic, summary: l.summary || "", scheduledAt: l.scheduledAt ? new Date(l.scheduledAt) : null, heldAt: l.heldAt ? new Date(l.heldAt) : null, venue: l.venue, lecturer: l.lecturer, sourceDocumentId: l.sourceDocumentId }, update: { courseId: l.courseId, topic: l.topic, summary: l.summary || "", scheduledAt: l.scheduledAt ? new Date(l.scheduledAt) : null, heldAt: l.heldAt ? new Date(l.heldAt) : null, venue: l.venue, lecturer: l.lecturer, sourceDocumentId: l.sourceDocumentId } });
      for (const a of assignments) await tx.assignment.upsert({ where: { id: a.id }, create: { id: a.id, courseId: a.courseId, title: a.title, details: a.details || "", dueAt: a.dueAt ? new Date(a.dueAt) : null, status: a.status || "TODO", submissionInstructions: a.submissionInstructions, source: a.source }, update: { courseId: a.courseId, title: a.title, details: a.details || "", dueAt: a.dueAt ? new Date(a.dueAt) : null, status: a.status || "TODO", submissionInstructions: a.submissionInstructions, source: a.source } });
      for (const a of attendance) await tx.attendanceSummary.upsert({ where: { id: a.id }, create: { id: a.id, courseId: a.courseId, sessionDate: new Date(a.sessionDate), presentCount: a.presentCount || 0, absentCount: a.absentCount || 0, note: a.note }, update: { courseId: a.courseId, sessionDate: new Date(a.sessionDate), presentCount: a.presentCount || 0, absentCount: a.absentCount || 0, note: a.note } });
      for (const c of concerns) await tx.classConcern.upsert({ where: { id: c.id }, create: { id: c.id, category: c.category || "GENERAL", title: c.title, details: c.details, status: c.status || "OPEN", resolution: c.resolution }, update: { category: c.category || "GENERAL", title: c.title, details: c.details, status: c.status || "OPEN", resolution: c.resolution } });
    }, { timeout: 60000 });
    let originalsRestored = 0;
    let originalsFailed = 0;
    if (archive) {
      for (const d of documents) {
        const expectedPrefix = `originals/${d.id}/`;
        const path = typeof d.archivePath === "string" && d.archivePath.startsWith(expectedPrefix) ? d.archivePath : "";
        const entry = path ? archive.file(path) : null;
        if (!entry) continue;
        const bytes = Buffer.from(await entry.async("nodebuffer"));
        if (bytes.length > 50 * 1024 * 1024) continue;
        const key = `documents/${d.id}/${String(d.filename || "original").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160)}`;
        try {
          const stored = await storeObject(key, bytes, String(d.mimeType || "application/octet-stream"));
          if (!stored) { originalsFailed += 1; continue; }
          await db.document.update({ where: { id: d.id }, data: { storageKey: stored } });
          originalsRestored += 1;
        } catch { originalsFailed += 1; }
      }
    }
    return NextResponse.json({ ok: true, originalsRestored, originalsFailed, originalsMissing: array(backup.missingOriginals).length, restored: { records: records.length, documents: documents.length, announcements: announcements.length, courses: courses.length, lectures: lectures.length, assignments: assignments.length, attendance: attendance.length, concerns: concerns.length }, note: archive ? "Original files included in the ZIP were restored when object storage is configured." : "JSON restore includes searchable text only. Use a complete ZIP backup to restore original files." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `Restore failed: ${error.message}` : "Restore failed" }, { status: 400 });
  }
}
