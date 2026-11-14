import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, requireStaff } from "@/lib/http";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
// STUDENT remains accepted only for syncing legacy records; the UI no longer creates them.
const allowedTypes = new Set(["COURSE", "LECTURE", "ANNOUNCEMENT", "TASK", "STUDENT", "CONCERN", "CALENDAR", "TIMETABLE"]);
const MAX_BATCH = 100;

type Mutation = {
  id?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  operation?: unknown;
  baseVersion?: unknown;
  payload?: unknown;
};

function validDate(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Push is idempotent: the client mutation UUID is the durable receipt key.
 * A stale offline edit is rejected rather than silently overwriting newer cloud data.
 */
export async function POST(req: NextRequest) {  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;

  // Read the session once and use that same authenticated identity for all
  // role checks below; avoid a second lookup producing a nullable actor.
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.mutations)) {
    return NextResponse.json({ error: "mutations must be an array" }, { status: 400 });
  }
  if (body.mutations.length > MAX_BATCH) {
    return NextResponse.json({ error: `A sync batch may contain at most ${MAX_BATCH} mutations` }, { status: 413 });
  }

  const appliedIds: string[] = [];
  const conflicts: Array<{ id: string; entityId: string; reason: string; serverRecord?: unknown }> = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const raw of body.mutations as Mutation[]) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const entityId = typeof raw?.entityId === "string" ? raw.entityId : "";
    if (!id || id.length > 100 || !entityId || entityId.length > 100 || raw.entityType !== "record") {
      rejected.push({ id, reason: "Invalid mutation identity or entity type" });
      continue;
    }
    const operation = raw.operation === "delete" ? "delete" : raw.operation === "upsert" ? "upsert" : "";
    const baseVersion = Number.isSafeInteger(raw.baseVersion) && Number(raw.baseVersion) >= 0 ? Number(raw.baseVersion) : undefined;
    if (!operation) {
      rejected.push({ id, reason: "Unsupported operation" });
      continue;
    }
    // Every queued mutation is created with a base version (including new records at 0).
    // Never fall back to timestamp-only or unconditional writes: an old offline client
    // without a version must be reviewed/recreated rather than overwrite newer cloud data.
    if (baseVersion === undefined) {
      rejected.push({ id, reason: "Missing or invalid base version; refresh the record before syncing" });
      continue;
    }
    if (actor?.role === "ASSISTANT_REP" && operation === "delete") {
      rejected.push({ id, reason: "Only the Class Representative can delete synced records" });
      continue;
    }
    const syncPayload = raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
      ? raw.payload as { status?: unknown }
      : null;
    const syncStatus = syncPayload?.status;
    const allowedStatuses = new Set(["ACTIVE", "DONE", "ARCHIVED", "DRAFT", "APPROVED", "PUBLISHED"]);
    if (syncStatus !== undefined && (typeof syncStatus !== "string" || !allowedStatuses.has(syncStatus))) {
      rejected.push({ id, reason: "Unsupported record status" });
      continue;
    }
    if (actor?.role === "ASSISTANT_REP" && typeof syncStatus === "string" && !["ACTIVE", "DONE", "DRAFT"].includes(syncStatus)) {
      rejected.push({ id, reason: "Only the Class Representative can set approval, publication or archive states" });
      continue;
    }

    try {
      const outcome = await db.$transaction(async (tx) => {
        const receipt = await tx.syncMutation.findUnique({ where: { id } });
        if (receipt?.appliedAt) return { state: "applied" as const };

        const current = await tx.academicRecord.findUnique({ where: { id: entityId } });
        if (operation === "delete") {
          if (current && baseVersion !== undefined && current.version !== baseVersion) return { state: "conflict" as const, record: current };
          if (current && baseVersion === undefined) {
            const queuedAt = typeof (raw.payload as { updatedAt?: unknown } | null)?.updatedAt === "string" ? new Date(String((raw.payload as { updatedAt: string }).updatedAt)) : null;
            if (queuedAt && !Number.isNaN(queuedAt.getTime()) && current.updatedAt.getTime() > queuedAt.getTime() + 1000) return { state: "conflict" as const, record: current };
          }
          if (current) {
            const payload = (raw.payload && typeof raw.payload === "object" ? raw.payload : {}) as Prisma.InputJsonValue;
            await tx.academicRecord.delete({ where: { id: entityId } });
            await tx.syncMutation.upsert({
              where: { id },
              create: { id, entityType: "record", entityId, operation, payload, appliedAt: new Date() },
              update: { entityType: "record", entityId, operation, payload, appliedAt: new Date() },
            });
          } else {
            await tx.syncMutation.upsert({
              where: { id },
              create: { id, entityType: "record", entityId, operation, payload: {} as Prisma.InputJsonValue, appliedAt: new Date() },
              update: { appliedAt: new Date() },
            });
          }
          return { state: "applied" as const };
        }

        const payload = raw.payload as Record<string, unknown> | null;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { state: "rejected" as const, reason: "Missing record payload" };
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        const type = typeof payload.type === "string" ? payload.type : "";
        if (!title || title.length > 180 || !allowedTypes.has(type)) return { state: "rejected" as const, reason: "Invalid title or record type" };
        if (typeof payload.content !== "string" || payload.content.length > 100_000) return { state: "rejected" as const, reason: "Invalid record content" };
        const eventDate = validDate(payload.eventDate);
        if (eventDate === undefined) return { state: "rejected" as const, reason: "Invalid event date" };
        const clientUpdatedAt = validDate(payload.updatedAt);
        if (current && baseVersion !== undefined && current.version !== baseVersion) return { state: "conflict" as const, record: current };
        if (!current && baseVersion !== undefined && baseVersion > 0) return { state: "conflict" as const, record: null };
        if (current && baseVersion === undefined && clientUpdatedAt && current.updatedAt.getTime() > clientUpdatedAt.getTime() + 1000) return { state: "conflict" as const, record: current };
        const serializedMetadata = payload.metadata === undefined ? "" : (JSON.stringify(payload.metadata) || "");
        if (serializedMetadata.length > 20000) return { state: "rejected" as const, reason: "Record metadata exceeds 20 KB" };
        const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? payload.metadata as Prisma.InputJsonValue
          : {} as Prisma.InputJsonValue;
        await tx.academicRecord.upsert({
          where: { id: entityId },
          create: { id: entityId, type: type as never, title, content: payload.content, metadata, eventDate, status: typeof payload.status === "string" ? payload.status.slice(0, 40) : "ACTIVE" },
          update: { type: type as never, title, content: payload.content, metadata, eventDate, version: { increment: 1 }, ...(typeof payload.status === "string" ? { status: payload.status.slice(0, 40) } : {}) },
        });
        await tx.syncMutation.upsert({
          where: { id },
          create: { id, entityType: "record", entityId, operation, payload: payload as unknown as Prisma.InputJsonValue, appliedAt: new Date() },
          update: { entityType: "record", entityId, operation, payload: payload as unknown as Prisma.InputJsonValue, appliedAt: new Date() },
        });
        return { state: "applied" as const };
      });
      if (outcome.state === "applied") appliedIds.push(id);
      else if (outcome.state === "conflict") conflicts.push({ id, entityId, reason: "A newer server version exists", serverRecord: outcome.record });
      else rejected.push({ id, reason: outcome.reason });
    } catch (error) {
      rejected.push({ id, reason: error instanceof Error ? error.message : "Mutation failed" });
    }
  }

  return NextResponse.json({ ok: rejected.length === 0, applied: appliedIds.length, appliedIds, conflicts, rejected, serverTime: new Date().toISOString() });
}

/** Pull cloud changes since an ISO timestamp, including deletion tombstones. */
export async function GET(req: NextRequest) {
  const denied = await requireStaff();
  if (denied) return denied;
  const rawSince = req.nextUrl.searchParams.get("since");
  const since = rawSince ? new Date(rawSince) : new Date(0);
  if (Number.isNaN(since.getTime())) return NextResponse.json({ error: "since must be a valid ISO timestamp" }, { status: 400 });
  // Capture a high-water mark before reading. Writes after this point are picked up
  // on the next pull, avoiding a gap between the query and the returned cursor.
  const watermark = new Date();
  const [records, tombstones] = await Promise.all([
    db.academicRecord.findMany({ where: { updatedAt: { gte: since, lte: watermark } }, orderBy: { updatedAt: "asc" } }),
    db.syncMutation.findMany({ where: { entityType: "record", operation: "delete", appliedAt: { gte: since, lte: watermark } }, orderBy: { appliedAt: "asc" }, select: { entityId: true, appliedAt: true } }),
  ]);
  // If an ID was restored/recreated after an older deletion, the newer
  // live record wins. Do not let an older tombstone erase it on the client.
  const liveUpdatedAt = new Map(records.map((record) => [record.id, record.updatedAt.getTime()]));
  const deletedIds = [...new Set(tombstones
    .filter((item) => {
      const recreatedAt = liveUpdatedAt.get(item.entityId);
      return recreatedAt === undefined || item.appliedAt!.getTime() > recreatedAt;
    })
    .map((item) => item.entityId))];
  return NextResponse.json({ records, deletedIds, serverTime: watermark.toISOString() });
}
