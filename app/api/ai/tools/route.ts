import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertSameOrigin, requirePrimaryAdmin, requireStaff, rateLimit, clientIp } from "@/lib/http";
import { deleteObject } from "@/lib/storage";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 30;

const allowedSqlTables = new Set([
  "AcademicRecord", "Document", "DocumentChunk", "Announcement", "AnnouncementVersion",
  "AnnouncementEvent", "SyncMutation", "Course", "LectureSession", "Assignment",
  "AttendanceSummary", "ClassConcern", "RateLimitBucket", "AiTask", "AuditLog"
]);

function jsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  if (!(await rateLimit(`ava-tools:${clientIp(req)}`, 60, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Ava tool usage limit reached. Try again shortly." }, { status: 429 });
  }
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");

  if (action === "search_documents") {
    const query = String(body?.query || "").trim().slice(0, 160);
    if (!query) return NextResponse.json({ error: "A search query is required." }, { status: 400 });
    const documents = await db.document.findMany({
      where: { OR: [{ title: { contains: query, mode: "insensitive" } }, { filename: { contains: query, mode: "insensitive" } }, { topic: { contains: query, mode: "insensitive" } }] },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, title: true, filename: true, mimeType: true, sizeBytes: true, status: true, courseCode: true, topic: true, createdAt: true }
    });
    return NextResponse.json({ documents });
  }

  if (action === "read_document") {
    const id = String(body?.documentId || "");
    if (!id) return NextResponse.json({ error: "documentId is required." }, { status: 400 });
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, title: true, filename: true, extractedText: true, status: true, courseCode: true, topic: true }
    });
    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    return NextResponse.json({ document: { ...document, extractedText: document.extractedText.slice(0, 24000), truncated: document.extractedText.length > 24000 } });
  }

  if (action === "preview_delete_document" || action === "delete_document" || action === "sql_select") {
    const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied;
  }

  if (action === "preview_delete_document") {
    const id = String(body?.documentId || "");
    if (!id) return NextResponse.json({ error: "documentId is required." }, { status: 400 });
    const document = await db.document.findUnique({
      where: { id },
      select: { id: true, title: true, filename: true, mimeType: true, sizeBytes: true, storageKey: true, status: true }
    });
    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    return NextResponse.json({
      preview: {
        documentId: document.id, title: document.title, filename: document.filename,
        sizeBytes: document.sizeBytes, databaseRecord: true,
        originalInSharedStorage: Boolean(document.storageKey),
        action: "Permanently delete the database record, extracted text, indexed chunks and original object-storage file."
      },
      requiresConfirmation: true
    });
  }

  if (action === "delete_document") {
    const id = String(body?.documentId || "");
    const confirmation = String(body?.confirmTitle || "");
    if (body?.confirmPermanent !== true || !id || !confirmation) {
      return NextResponse.json({ error: "Explicit permanent-deletion confirmation and the exact document title are required." }, { status: 400 });
    }
    const document = await db.document.findUnique({ where: { id }, select: { id: true, title: true, filename: true, sizeBytes: true, storageKey: true } });
    if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    if (confirmation !== document.title) return NextResponse.json({ error: "The confirmation title does not match the document." }, { status: 409 });
    const auditId = randomUUID();
    await db.auditLog.create({
      data: {
        id: auditId, actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
        action: "DOCUMENT_DELETE_STARTED", targetType: "Document", targetId: id,
        details: { title: document.title, filename: document.filename, sizeBytes: document.sizeBytes } as Prisma.InputJsonValue
      }
    });
    try {
      if (document.storageKey) await deleteObject(document.storageKey);
      await db.document.delete({ where: { id } });
      await db.auditLog.create({
        data: {
          id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
          action: "DOCUMENT_DELETE_SUCCEEDED", targetType: "Document", targetId: id,
          details: { title: document.title, storageObjectDeleted: Boolean(document.storageKey), databaseRecordDeleted: true } as Prisma.InputJsonValue
        }
      });
      return NextResponse.json({ ok: true, deleted: { documentId: id, databaseRecord: true, sharedStorageObject: Boolean(document.storageKey) } });
    } catch (error) {
      await db.auditLog.create({
        data: {
          id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
          action: "DOCUMENT_DELETE_FAILED", targetType: "Document", targetId: id,
          details: { title: document.title, error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" } as Prisma.InputJsonValue
        }
      }).catch(() => undefined);
      return NextResponse.json({ error: "Deletion did not fully complete. Check the audit log and storage/database state before retrying." }, { status: 502 });
    }
  }

  if (action === "sql_select") {
    const query = String(body?.query || "").trim();
    if (!query || query.length > 4000 || !/^SELECT\b/i.test(query)) {
      return NextResponse.json({ error: "Only a single SELECT statement of at most 4,000 characters is allowed." }, { status: 400 });
    }
    if (/[;]|--|\/\*|\*\/|\bFOR\s+UPDATE\b|\bINTO\s+OUTFILE\b|\bINTO\s+DUMPFILE\b/i.test(query) ||
        /\b(pg_catalog|information_schema|pg_read_file|pg_ls_dir|pg_sleep|dblink|set_config|current_setting|lo_import|lo_export|nextval|setval)\b/i.test(query)) {
      return NextResponse.json({ error: "This SQL contains a disallowed statement, comment, system catalogue or side-effect function." }, { status: 400 });
    }
    const tableRefs = [...query.matchAll(/\b(?:FROM|JOIN)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(match => match[1]);
    if (tableRefs.some(table => !allowedSqlTables.has(table))) {
      return NextResponse.json({ error: "SQL editor access is limited to approved ClassDesk tables." }, { status: 403 });
    }
    try {
      const rows = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
        return tx.$queryRawUnsafe("SELECT * FROM (" + query + ") AS ava_read_only_result LIMIT 100");
      });
      const digest = createHash("sha256").update(query).digest("hex");
      await db.auditLog.create({
        data: {
          id: randomUUID(), actorId: actor.id, actorUsername: actor.username, actorRole: actor.role,
          action: "SQL_SELECT_EXECUTED", targetType: "SQL", targetId: digest,
          details: { queryHash: digest, returnedRows: Array.isArray(rows) ? rows.length : 0 } as Prisma.InputJsonValue
        }
      });
      return NextResponse.json({ rows: jsonSafe(rows), rowCount: Array.isArray(rows) ? rows.length : 0, limited: Array.isArray(rows) && rows.length === 100 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Read-only SQL query failed." }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Unknown Ava tool action." }, { status: 400 });
}
