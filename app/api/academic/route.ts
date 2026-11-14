import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireStaff, requirePrimaryAdmin, assertSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
type Resource = "courses" | "lectures" | "assignments" | "attendance" | "concerns" | "summary";
const resources = new Set<Resource>(["courses", "lectures", "assignments", "attendance", "concerns", "summary"]);
function resourceOf(value: string | null): Resource | null { return value && resources.has(value as Resource) ? value as Resource : null; }
function dateOf(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date;
}
function text(value: unknown, max = 5000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export async function GET(req: NextRequest) {
  const denied = await requireStaff(); if (denied) return denied;
  const resource = resourceOf(req.nextUrl.searchParams.get("resource"));
  if (!resource) return NextResponse.json({ error: "Valid resource is required" }, { status: 400 });
  const q = text(req.nextUrl.searchParams.get("q"), 100);
  if (resource === "summary") {
    const [courses, lectures, assignments, concerns, upcomingAssignments] = await Promise.all([
      db.course.count({ where: { active: true } }),
      db.lectureSession.count(),
      db.assignment.count({ where: { status: { not: "DONE" } } }),
      db.classConcern.count({ where: { status: { not: "RESOLVED" } } }),
      db.assignment.findMany({ where: { status: { not: "DONE" }, dueAt: { not: null } }, include: { course: { select: { code: true } } }, orderBy: { dueAt: "asc" }, take: 6 }),
    ]);
    return NextResponse.json({ summary: { courses, lectures, assignments, concerns }, upcomingAssignments });
  }
  if (resource === "courses") return NextResponse.json({ items: await db.course.findMany({ where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}, orderBy: [{ active: "desc" }, { code: "asc" }] }) });
  if (resource === "lectures") return NextResponse.json({ items: await db.lectureSession.findMany({ where: q ? { OR: [{ topic: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }] } : {}, include: { course: { select: { id: true, code: true, name: true } } }, orderBy: [{ heldAt: "desc" }, { createdAt: "desc" }], take: 300 }) });
  if (resource === "assignments") return NextResponse.json({ items: await db.assignment.findMany({ where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { details: { contains: q, mode: "insensitive" } }] } : {}, include: { course: { select: { id: true, code: true, name: true } } }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 300 }) });
  if (resource === "attendance") return NextResponse.json({ items: await db.attendanceSummary.findMany({ include: { course: { select: { id: true, code: true, name: true } } }, orderBy: { sessionDate: "desc" }, take: 300 }) });
  return NextResponse.json({ items: await db.classConcern.findMany({ where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { details: { contains: q, mode: "insensitive" } }] } : {}, orderBy: { updatedAt: "desc" }, take: 300 }) });
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null);
  const resource = resourceOf(body?.resource);
  if (!resource || resource === "summary") return NextResponse.json({ error: "A writable resource is required" }, { status: 400 });
  const id = text(body.id, 100) || randomUUID();
  try {
    if (resource === "courses") {
      const code = text(body.code, 40).toUpperCase(); const name = text(body.name, 180);
      if (!code || !name) return NextResponse.json({ error: "Course code and name are required" }, { status: 400 });
      const item = await db.course.upsert({ where: { id }, create: { id, code, name, lecturer: text(body.lecturer, 120) || null, semester: text(body.semester, 80) || null, description: text(body.description, 5000) || null }, update: { code, name, lecturer: text(body.lecturer, 120) || null, semester: text(body.semester, 80) || null, description: text(body.description, 5000) || null } });
      return NextResponse.json({ item }, { status: 201 });
    }
    if (resource === "lectures") {
      const topic = text(body.topic, 180); if (!topic) return NextResponse.json({ error: "Lecture topic is required" }, { status: 400 });
      const scheduledAt = dateOf(body.scheduledAt); const heldAt = dateOf(body.heldAt);
      if ((body.scheduledAt !== undefined && scheduledAt === undefined) || (body.heldAt !== undefined && heldAt === undefined)) return NextResponse.json({ error: "Invalid lecture date" }, { status: 400 });
      const item = await db.lectureSession.upsert({ where: { id }, create: { id, topic, summary: text(body.summary, 10000), courseId: text(body.courseId, 100) || null, scheduledAt, heldAt, venue: text(body.venue, 120) || null, lecturer: text(body.lecturer, 120) || null }, update: { topic, summary: text(body.summary, 10000), courseId: text(body.courseId, 100) || null, scheduledAt, heldAt, venue: text(body.venue, 120) || null, lecturer: text(body.lecturer, 120) || null } });
      return NextResponse.json({ item }, { status: 201 });
    }
    if (resource === "assignments") {
      const title = text(body.title, 180); if (!title) return NextResponse.json({ error: "Assignment title is required" }, { status: 400 });
      const dueAt = dateOf(body.dueAt); if (body.dueAt !== undefined && dueAt === undefined) return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      const item = await db.assignment.upsert({ where: { id }, create: { id, title, details: text(body.details, 10000), courseId: text(body.courseId, 100) || null, dueAt, submissionInstructions: text(body.submissionInstructions, 5000) || null, source: text(body.source, 180) || null }, update: { title, details: text(body.details, 10000), courseId: text(body.courseId, 100) || null, dueAt, submissionInstructions: text(body.submissionInstructions, 5000) || null, source: text(body.source, 180) || null } });
      return NextResponse.json({ item }, { status: 201 });
    }
    if (resource === "attendance") {
      const sessionDate = dateOf(body.sessionDate); const presentCount = Number(body.presentCount); const absentCount = Number(body.absentCount);
      if (!sessionDate || presentCount < 0 || absentCount < 0 || !Number.isInteger(presentCount) || !Number.isInteger(absentCount)) return NextResponse.json({ error: "Enter a valid date and non-negative whole-number counts" }, { status: 400 });
      const item = await db.attendanceSummary.upsert({ where: { id }, create: { id, sessionDate, presentCount, absentCount, courseId: text(body.courseId, 100) || null, note: text(body.note, 2000) || null }, update: { sessionDate, presentCount, absentCount, courseId: text(body.courseId, 100) || null, note: text(body.note, 2000) || null } });
      return NextResponse.json({ item }, { status: 201 });
    }
    const title = text(body.title, 180); const details = text(body.details, 10000);
    if (!title || !details) return NextResponse.json({ error: "Concern title and details are required" }, { status: 400 });
    const item = await db.classConcern.upsert({ where: { id }, create: { id, title, details, category: text(body.category, 60).toUpperCase() || "GENERAL", resolution: text(body.resolution, 10000) || null }, update: { title, details, category: text(body.category, 60).toUpperCase() || "GENERAL", resolution: text(body.resolution, 10000) || null } });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message.includes("Unique constraint") ? "That course code already exists" : "Could not save this item. Check the selected course and fields." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null); const resource = resourceOf(body?.resource); const id = text(body?.id, 100);
  if (!resource || resource === "summary" || !id) return NextResponse.json({ error: "Writable resource and id are required" }, { status: 400 });
  if (resource === "courses" && body.active === false) { const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied; }
  if (resource === "courses" && body.active === "false") { const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied; }
  try {
    if (resource === "courses") {
      const item = await db.course.update({ where: { id }, data: { ...(typeof body.code === "string" ? { code: text(body.code, 40).toUpperCase() } : {}), ...(typeof body.name === "string" ? { name: text(body.name, 180) } : {}), ...(typeof body.lecturer === "string" ? { lecturer: text(body.lecturer, 120) || null } : {}), ...(typeof body.semester === "string" ? { semester: text(body.semester, 80) || null } : {}), ...(typeof body.active === "boolean" ? { active: body.active } : typeof body.active === "string" && ["true", "false"].includes(body.active) ? { active: body.active === "true" } : {}), ...(typeof body.description === "string" ? { description: text(body.description, 5000) || null } : {}) } }); return NextResponse.json({ item });
    }
    if (resource === "lectures") {
      const heldAt = dateOf(body.heldAt); const scheduledAt = dateOf(body.scheduledAt);
      if ((body.heldAt !== undefined && heldAt === undefined) || (body.scheduledAt !== undefined && scheduledAt === undefined)) return NextResponse.json({ error: "Invalid lecture date" }, { status: 400 });
      const item = await db.lectureSession.update({ where: { id }, data: { ...(typeof body.topic === "string" ? { topic: text(body.topic, 180) } : {}), ...(typeof body.summary === "string" ? { summary: text(body.summary, 10000) } : {}), ...(body.courseId !== undefined ? { courseId: text(body.courseId, 100) || null } : {}), ...(body.heldAt !== undefined ? { heldAt: heldAt ?? null } : {}), ...(body.scheduledAt !== undefined ? { scheduledAt: scheduledAt ?? null } : {}), ...(typeof body.venue === "string" ? { venue: text(body.venue, 120) || null } : {}), ...(typeof body.lecturer === "string" ? { lecturer: text(body.lecturer, 120) || null } : {}) } }); return NextResponse.json({ item });
    }
    if (resource === "assignments") {
      const dueAt = dateOf(body.dueAt); if (body.dueAt !== undefined && dueAt === undefined) return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      const item = await db.assignment.update({ where: { id }, data: { ...(typeof body.title === "string" ? { title: text(body.title, 180) } : {}), ...(typeof body.details === "string" ? { details: text(body.details, 10000) } : {}), ...(body.dueAt !== undefined ? { dueAt: dueAt ?? null } : {}), ...(body.courseId !== undefined ? { courseId: text(body.courseId, 100) || null } : {}), ...(body.status === "TODO" || body.status === "IN_PROGRESS" || body.status === "DONE" ? { status: body.status } : {}), ...(typeof body.submissionInstructions === "string" ? { submissionInstructions: text(body.submissionInstructions, 5000) || null } : {}), ...(typeof body.source === "string" ? { source: text(body.source, 180) || null } : {}) } }); return NextResponse.json({ item });
    }
    if (resource === "attendance") {
      const sessionDate = dateOf(body.sessionDate);
      if (body.sessionDate !== undefined && !sessionDate) return NextResponse.json({ error: "Invalid session date" }, { status: 400 });
      if ((body.presentCount !== undefined && (!Number.isInteger(body.presentCount) || body.presentCount < 0)) || (body.absentCount !== undefined && (!Number.isInteger(body.absentCount) || body.absentCount < 0))) return NextResponse.json({ error: "Attendance counts must be non-negative whole numbers" }, { status: 400 });
      const item = await db.attendanceSummary.update({ where: { id }, data: { ...(body.sessionDate !== undefined ? { sessionDate: sessionDate! } : {}), ...(body.courseId !== undefined ? { courseId: text(body.courseId, 100) || null } : {}), ...(body.presentCount !== undefined ? { presentCount: body.presentCount } : {}), ...(body.absentCount !== undefined ? { absentCount: body.absentCount } : {}), ...(typeof body.note === "string" ? { note: text(body.note, 2000) || null } : {}) } }); return NextResponse.json({ item });
    }
    const allowed = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    const item = await db.classConcern.update({ where: { id }, data: { ...(typeof body.category === "string" ? { category: text(body.category, 60).toUpperCase() || "GENERAL" } : {}), ...(typeof body.title === "string" ? { title: text(body.title, 180) } : {}), ...(typeof body.details === "string" ? { details: text(body.details, 10000) } : {}), ...(allowed.includes(body.status) ? { status: body.status } : {}), ...(typeof body.resolution === "string" ? { resolution: text(body.resolution, 10000) || null } : {}) } }); return NextResponse.json({ item });
  } catch { return NextResponse.json({ error: "Item not found or update failed" }, { status: 404 }); }
}

export async function DELETE(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied;
  const resource = resourceOf(req.nextUrl.searchParams.get("resource")); const id = text(req.nextUrl.searchParams.get("id"), 100);
  if (!resource || resource === "summary" || !id) return NextResponse.json({ error: "Writable resource and id are required" }, { status: 400 });
  try {
    if (resource === "courses") await db.course.delete({ where: { id } });
    else if (resource === "lectures") await db.lectureSession.delete({ where: { id } });
    else if (resource === "assignments") await db.assignment.delete({ where: { id } });
    else if (resource === "attendance") await db.attendanceSummary.delete({ where: { id } });
    else await db.classConcern.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Item not found or could not be deleted" }, { status: 404 }); }
}
