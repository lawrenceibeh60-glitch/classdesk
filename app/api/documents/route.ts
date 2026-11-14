import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireStaff, requirePrimaryAdmin, assertSameOrigin, rateLimit, clientIp } from "@/lib/http";
import { extractText, splitIntoChunks } from "@/lib/ingest";
import { storeObject, deleteObject } from "@/lib/storage";
import { scanWithClamAV } from "@/lib/malware";

export const runtime = "nodejs";
export const maxDuration = 60;
const allowedExtensions = new Set(["pdf", "docx", "pptx", "txt", "md", "png", "jpg", "jpeg", "webp"]);
const contentTypes: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function extension(filename: string) { return filename.split(".").pop()?.toLowerCase() || ""; }
function validateSignature(ext: string, bytes: Buffer) {
  if (ext === "pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (ext === "docx" || ext === "pptx") return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (ext === "png") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === "jpg" || ext === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === "webp") return bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP";
  if (ext === "txt" || ext === "md") return !bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0);
  return false;
}

export async function GET() {
  const denied = await requireStaff();
  if (denied) return denied;
  const documents = await db.document.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, title: true, filename: true, mimeType: true, sizeBytes: true, courseCode: true, courseName: true, lectureDate: true, topic: true, status: true, securityScanStatus: true, errorMessage: true, createdAt: true, storageKey: true } });
  return NextResponse.json({ documents: documents.map(({ storageKey, ...document }) => ({ ...document, originalAvailable: Boolean(storageKey) })) });
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  if (!(await rateLimit(`upload:${clientIp(req)}`, 20, 60 * 60 * 1000))) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429 });
  let storedKey: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Select a document" }, { status: 400 });
    const requestedMax = Number(process.env.MAX_UPLOAD_MB || 20);
    const max = (Number.isFinite(requestedMax) ? Math.min(Math.max(requestedMax, 1), 50) : 20) * 1024 * 1024;
    if (file.size < 1) return NextResponse.json({ error: "The selected file is empty" }, { status: 400 });
    if (file.size > max) return NextResponse.json({ error: `File exceeds ${Math.round(max / 1024 / 1024)} MB limit` }, { status: 413 });
    const ext = extension(file.name);
    if (!allowedExtensions.has(ext)) return NextResponse.json({ error: "Supported formats: PDF, DOCX, PPTX, TXT, Markdown, PNG, JPG and WEBP" }, { status: 415 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateSignature(ext, buffer)) return NextResponse.json({ error: "The file contents do not match the selected file type" }, { status: 415 });
    const requestedId = String(form.get("id") || "");
    if (requestedId && !/^[a-f0-9-]{36}$/i.test(requestedId)) return NextResponse.json({ error: "Invalid document upload ID" }, { status: 400 });
    const id = requestedId || randomUUID();
    const existing = await db.document.findUnique({ where: { id }, select: { id: true, title: true, status: true, chunks: { select: { id: true } } } });
    if (existing) return NextResponse.json({ document: { id: existing.id, title: existing.title, status: existing.status, chunkCount: existing.chunks.length, duplicate: true } }, { status: 200 });
    const canonicalMime = contentTypes[ext];
    const securityScanStatus = await scanWithClamAV(buffer);
    if (securityScanStatus === "INFECTED") return NextResponse.json({ error: "The uploaded file was flagged by malware scanning and was rejected." }, { status: 422 });
    const extracted = await extractText(buffer, canonicalMime, file.name);
    const text = extracted.replace(/\u0000/g, "").trim();
    if (!text) return NextResponse.json({ error: "No text could be extracted. Check image clarity and language; OCR currently supports English images." }, { status: 422 });
    if (text.length > 2_000_000) return NextResponse.json({ error: "Extracted text exceeds the 2 MB indexing limit" }, { status: 413 });
    const chunks = splitIntoChunks(text);
    const rawDate = form.get("lectureDate");
    const lectureDate = rawDate ? new Date(String(rawDate)) : null;
    if (lectureDate && Number.isNaN(lectureDate.getTime())) return NextResponse.json({ error: "Invalid lecture date" }, { status: 400 });
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || `document.${ext}`;
    const key = `documents/${id}/${safeFilename}`;
    try {
      storedKey = await storeObject(key, buffer, canonicalMime);
    } catch (storageError) {
      console.error("document object storage failed", storageError);
      return NextResponse.json(
        { error: "Shared file storage is unavailable. Ask the Class Representative to check the storage configuration, then retry the upload." },
        { status: 503 },
      );
    }
    const doc = await db.document.create({ data: {
      id, title: String(form.get("title") || file.name).trim().slice(0, 180), filename: safeFilename,
      mimeType: canonicalMime, sizeBytes: file.size, storageKey: storedKey,
      extractedText: text, courseCode: String(form.get("courseCode") || "").trim().slice(0, 40) || null,
      courseName: String(form.get("courseName") || "").trim().slice(0, 180) || null,
      topic: String(form.get("topic") || "").trim().slice(0, 180) || null, lectureDate,
      status: "READY", securityScanStatus, chunks: { create: chunks.map((content, chunkIndex) => ({ content, chunkIndex })) },
    } });
    return NextResponse.json({ document: { id: doc.id, title: doc.title, status: doc.status, chunkCount: chunks.length, characters: text.length } }, { status: 201 });
  } catch (error) {
    if (storedKey) await deleteObject(storedKey).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Document processing failed" }, { status: 422 });
  }
}

export async function DELETE(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied;
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const doc = await db.document.findUnique({ where: { id }, select: { id: true, title: true, filename: true, sizeBytes: true, storageKey: true } });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  await db.auditLog.create({
    data: {
      id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
      action: "DOCUMENT_DELETE_STARTED", targetType: "Document", targetId: id,
      details: { title: doc.title, filename: doc.filename, sizeBytes: doc.sizeBytes } as Prisma.InputJsonValue
    }
  });
  if (doc.storageKey) {
    try {
      await deleteObject(doc.storageKey);
      await db.document.update({ where: { id }, data: { storageKey: null } });
    } catch (error) {
      await db.auditLog.create({
        data: {
          id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
          action: "DOCUMENT_DELETE_FAILED", targetType: "Document", targetId: id,
          details: { title: doc.title, error: error instanceof Error ? error.message.slice(0, 500) : "Storage deletion failed" } as Prisma.InputJsonValue
        }
      }).catch(() => undefined);
      return NextResponse.json({ error: "The original file could not be deleted from shared storage. The SQL record was kept; retry after checking storage connectivity." }, { status: 502 });
    }
  }
  try {
    await db.document.delete({ where: { id } });
    await db.auditLog.create({
      data: {
        id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
        action: "DOCUMENT_DELETE_SUCCEEDED", targetType: "Document", targetId: id,
        details: { title: doc.title, storageObjectDeleted: Boolean(doc.storageKey), databaseRecordDeleted: true } as Prisma.InputJsonValue
      }
    });
    return NextResponse.json({ ok: true, deleted: { databaseRecord: true, sharedStorageObject: Boolean(doc.storageKey) } });
  } catch (error) {
    await db.auditLog.create({
      data: {
        id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
        action: "DOCUMENT_DELETE_FAILED", targetType: "Document", targetId: id,
        details: { title: doc.title, error: error instanceof Error ? error.message.slice(0, 500) : "Database deletion failed" } as Prisma.InputJsonValue
      }
    }).catch(() => undefined);
    return NextResponse.json({ error: "The storage object was deleted, but the SQL record remains. Review the audit log and retry the record deletion." }, { status: 502 });
  }
}
