import { NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/http";
import { readObject } from "@/lib/storage";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  const denied = await requireAdmin(); if (denied) return denied;
  const [records, documents, announcements, courses, lectures, assignments, attendance, concerns] = await Promise.all([
    db.academicRecord.findMany({ orderBy: { createdAt: "asc" } }),
    db.document.findMany({ include: { chunks: { orderBy: { chunkIndex: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.announcement.findMany({ include: { versions: { orderBy: { version: "asc" } }, events: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.course.findMany({ orderBy: { code: "asc" } }), db.lectureSession.findMany(), db.assignment.findMany(), db.attendanceSummary.findMany(), db.classConcern.findMany(),
  ]);
  const zip = new JSZip(); const missingOriginals: string[] = documents.filter(document => !document.storageKey).map(document => document.filename);
  const safeDocuments: Array<Record<string, unknown>> = []; let originalBytes = 0;
  for (const document of documents) {
    const { storageKey, ...metadata } = document;
    let archivePath: string | null = null;
    if (storageKey) {
      try {
        const bytes = await readObject(storageKey);
        if (originalBytes + bytes.length > 90 * 1024 * 1024) throw new Error("Archive originals size limit reached");
        originalBytes += bytes.length;
        archivePath = `originals/${document.id}/${document.filename}`; zip.file(archivePath, bytes);
      } catch { missingOriginals.push(document.filename); }
    }
    safeDocuments.push({ ...metadata, archivePath });
  }
  const backup = { format: "afit-classdesk-backup", schemaVersion: 1, exportedAt: new Date().toISOString(), note: "Includes searchable text and any original files available from configured object storage.", missingOriginals, records, documents: safeDocuments, announcements, courses, lectures, assignments, attendance, concerns };
  zip.file("backup.json", JSON.stringify(backup, null, 2));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=afit-classdesk-complete-backup.zip", "Cache-Control": "private, no-store" } });
}
