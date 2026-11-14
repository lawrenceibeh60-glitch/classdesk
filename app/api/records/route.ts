import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireStaff, requirePrimaryAdmin, assertSameOrigin } from "@/lib/http";
export const runtime = "nodejs";
const allowedTypes = ["COURSE", "LECTURE", "ANNOUNCEMENT", "TASK", "CONCERN", "CALENDAR", "TIMETABLE"];
const allowedStatuses = ["ACTIVE", "DONE", "ARCHIVED", "DRAFT", "APPROVED", "PUBLISHED"];
function parseDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: NextRequest) {
  const denied = await requireStaff(); if (denied) return denied;
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 200) : 50;
  const type = req.nextUrl.searchParams.get("type");
  if (type && !allowedTypes.includes(type)) return NextResponse.json({ error: "Invalid record type" }, { status: 400 });
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100);
  const upcoming = req.nextUrl.searchParams.get("upcoming") === "1";
  const records = await db.academicRecord.findMany({
    where: { ...(upcoming ? { eventDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }, status: { not: "DONE" } } : {}), ...(type ? { type: type as never } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { content: { contains: q, mode: "insensitive" as const } }] } : {}) },
    orderBy: upcoming ? { eventDate: "asc" } : { updatedAt: "desc" }, take: limit,
  });
  return NextResponse.json({ records });
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 180) : "";
  if (!title || !allowedTypes.includes(body?.type)) return NextResponse.json({ error: "A valid title and record type are required" }, { status: 400 });
  if (body.content !== undefined && (typeof body.content !== "string" || body.content.length > 100000)) return NextResponse.json({ error: "Record content must be text under 100 KB" }, { status: 400 });
  const eventDate = parseDate(body.eventDate);
  if (body.eventDate !== undefined && eventDate === undefined) return NextResponse.json({ error: "Invalid event date" }, { status: 400 });
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {};
  if (body.id !== undefined && (typeof body.id !== "string" || body.id.length > 100)) return NextResponse.json({ error: "Invalid record id" }, { status: 400 });
  const record = await db.academicRecord.create({ data: { ...(body.id ? { id: body.id } : {}), type: body.type, title, content: body.content || "", metadata, eventDate: eventDate ?? null, status: body.type === "ANNOUNCEMENT" ? "DRAFT" : "ACTIVE" } });
  return NextResponse.json({ record }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (["APPROVED", "PUBLISHED", "ARCHIVED"].includes(body?.status)) { const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied; }
  if (!body || typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const data: Prisma.AcademicRecordUpdateInput = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 180);
  if (typeof body.content === "string") { if (body.content.length > 100000) return NextResponse.json({ error: "Record content exceeds 100 KB" }, { status: 413 }); data.content = body.content; }
  if (typeof body.status === "string" && allowedStatuses.includes(body.status)) data.status = body.status;
  if (body.type !== undefined) { if (!allowedTypes.includes(body.type)) return NextResponse.json({ error: "Invalid record type" }, { status: 400 }); data.type = body.type as never; }
  if ("eventDate" in body) { const date = parseDate(body.eventDate); if (date === undefined) return NextResponse.json({ error: "Invalid eventDate" }, { status: 400 }); data.eventDate = date; }
  if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) data.metadata = body.metadata as Prisma.InputJsonValue;
  data.version = { increment: 1 };
  try { const record = await db.academicRecord.update({ where: { id: body.id }, data }); return NextResponse.json({ record }); }
  catch { return NextResponse.json({ error: "Record not found" }, { status: 404 }); }
}

export async function DELETE(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied;
  const id = req.nextUrl.searchParams.get("id"); if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.$transaction(async (tx) => {
    const existing = await tx.academicRecord.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return;
    await tx.academicRecord.delete({ where: { id } });
    await tx.syncMutation.create({ data: { id: randomUUID(), entityType: "record", entityId: id, operation: "delete", payload: {}, appliedAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
}
