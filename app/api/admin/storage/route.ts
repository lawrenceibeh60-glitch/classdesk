import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assertSameOrigin, requirePrimaryAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requirePrimaryAdmin();
  if (denied) return denied;

  const [records, documents, chunks, announcements, announcementVersions, announcementEvents, courses, lectures, assignments, attendance, concerns, syncPending, syncApplied, rateLimitBuckets, aiReceipts, aiTasks, auditLogs, workerStates] = await Promise.all([
    db.academicRecord.count(),
    db.document.count(),
    db.documentChunk.count(),
    db.announcement.count(),
    db.announcementVersion.count(),
    db.announcementEvent.count(),
    db.course.count(),
    db.lectureSession.count(),
    db.assignment.count(),
    db.attendanceSummary.count(),
    db.classConcern.count(),
    db.syncMutation.count({ where: { appliedAt: null } }),
    db.syncMutation.count({ where: { appliedAt: { not: null } } }),
    db.rateLimitBucket.count(),
    db.aiRequestReceipt.count(),
    db.aiTask.count(),
    db.auditLog.count(),
    db.aiWorkerState.count(),
  ]);

  let databaseBytes: number | null = null;
  let tableSizes: Array<{ table: string; bytes: number }> = [];
  try {
    const size = await db.$queryRaw<Array<{ bytes: bigint | string }>>`SELECT pg_database_size(current_database()) AS bytes`;
    const value = size[0]?.bytes;
    if (value !== undefined) databaseBytes = Number(value);
  } catch {
    // Some hosted Postgres roles restrict database-size introspection.
  }
  try {
    const sizes = await db.$queryRaw<Array<{ table: string; bytes: bigint | string }>>`SELECT relname AS "table", pg_total_relation_size(relid) AS bytes FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10`;
    tableSizes = sizes.map((row) => ({ table: row.table, bytes: Number(row.bytes) }));
  } catch {
    // Table-level size details are optional; row counts and total size remain available.
  }

  return NextResponse.json({
    counts: { records, documents, chunks, announcements, announcementVersions, announcementEvents, courses, lectures, assignments, attendance, concerns, syncPending, syncApplied, rateLimitBuckets, aiReceipts, aiTasks, auditLogs, workerStates },
    databaseBytes,
    tableSizes,
    cleanupPolicy: "Only expired rate-limit buckets, old applied non-deletion sync receipts and old AI idempotency receipts are eligible. Deletion tombstones are retained so long-offline devices can still receive deletions. Class records, announcements, documents and extracted text are never bulk-deleted here.",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;
  const denied = await requirePrimaryAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (body?.confirmation !== "CLEANUP_CLASSDESK_SQL") {
    return NextResponse.json({ error: "Type CLEANUP_CLASSDESK_SQL to confirm this operation" }, { status: 400 });
  }
  const retentionDays = Number(body.retentionDays);
  if (![30, 60, 90].includes(retentionDays)) {
    return NextResponse.json({ error: "Choose a supported retention period: 30, 60 or 90 days" }, { status: 400 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const [rateLimits, syncHistory, aiReceipts] = await db.$transaction([
    db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }),
    db.syncMutation.deleteMany({ where: { appliedAt: { not: null }, operation: { not: "delete" }, createdAt: { lt: cutoff } } }),
    db.aiRequestReceipt.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return NextResponse.json({
    ok: true,
    deleted: { expiredRateLimitBuckets: rateLimits.count, oldAppliedSyncMutations: syncHistory.count, oldAiRequestReceipts: aiReceipts.count },
    retainedSince: cutoff.toISOString(),
    message: "Temporary SQL housekeeping data cleaned. Class content and uploaded documents were left untouched.",
  });
}
