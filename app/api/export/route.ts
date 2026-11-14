import { NextResponse } from "next/server";
import { requirePrimaryAdmin } from "@/lib/http";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const denied = await requirePrimaryAdmin(); if (denied) return denied;
  const [records, documents, announcements, courses, lectures, assignments, attendance, concerns] = await Promise.all([
    db.academicRecord.findMany({ orderBy: { createdAt: "asc" } }),
    db.document.findMany({ include: { chunks: { orderBy: { chunkIndex: "asc" } } }, orderBy: { createdAt: "asc" } }).then(items => items.map(({ storageKey, ...item }) => item)),
    db.announcement.findMany({ include: { versions: { orderBy: { version: "asc" } }, events: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.course.findMany({ orderBy: { code: "asc" } }), db.lectureSession.findMany(), db.assignment.findMany(),
    db.attendanceSummary.findMany(), db.classConcern.findMany(),
  ]);
  const backup = { format: "afit-classdesk-backup", schemaVersion: 1, exportedAt: new Date().toISOString(), note: "Searchable document text and metadata are included. Original uploaded file bytes are not included; back up the configured S3-compatible bucket separately.", records, documents, announcements, courses, lectures, assignments, attendance, concerns };
  return new NextResponse(JSON.stringify(backup, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=afit-classdesk-backup.json", "Cache-Control": "private, no-store" } });
}
