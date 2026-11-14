import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff, requirePrimaryAdmin, assertSameOrigin } from "@/lib/http";
import { Prisma } from "@prisma/client";
export const runtime = "nodejs";
const placeholder = /\[[A-Z0-9 _/:-]{2,}\]/;
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export async function GET() {
  const denied = await requireStaff(); if (denied) return denied;
  const announcements = await db.announcement.findMany({ include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return NextResponse.json({ announcements });
}
export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null); const title = clean(body?.title, 180); const content = clean(body?.body, 20000);
  if (!title || !content) return NextResponse.json({ error: "Announcement title and body are required" }, { status: 400 });
  const id = clean(body.id, 100) || undefined;
  const announcement = id
    ? await db.announcement.upsert({ where: { id }, create: { id, title, body: content, category: clean(body.category, 60).toUpperCase() || "GENERAL", source: clean(body.source, 180) || null, status: "DRAFT", versions: { create: { version: 1, title, body: content, status: "DRAFT" } }, events: { create: { action: "CREATED", details: "Initial draft created." } } }, update: {}, include: { versions: true, events: { orderBy: { createdAt: "desc" } } } })
    : await db.announcement.create({ data: { title, body: content, category: clean(body.category, 60).toUpperCase() || "GENERAL", source: clean(body.source, 180) || null, status: "DRAFT", versions: { create: { version: 1, title, body: content, status: "DRAFT" } }, events: { create: { action: "CREATED", details: "Initial draft created." } } }, include: { versions: true, events: { orderBy: { createdAt: "desc" } } } });
  return NextResponse.json({ announcement }, { status: 201 });
}
export async function PATCH(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (body?.action !== "edit") { const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied; }
  if (!body?.id || typeof body.id !== "string") return NextResponse.json({ error: "Announcement id is required" }, { status: 400 });
  const current = await db.announcement.findUnique({ where: { id: body.id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!current) return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  if (body.action === "edit") {
    const title = clean(body.title, 180); const content = clean(body.body, 20000);
    if (!title || !content) return NextResponse.json({ error: "Announcement title and body are required" }, { status: 400 });
    const mutationId = clean(body.clientMutationId, 100);
    const version = (current.versions[0]?.version || 0) + 1;
    const announcement = await db.$transaction(async (tx) => {
      if (mutationId) {
        const receipt = await tx.syncMutation.findUnique({ where: { id: mutationId } });
        if (receipt?.appliedAt) return tx.announcement.findUnique({ where: { id: current.id }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
      }
      await tx.announcementVersion.create({ data: { announcementId: current.id, version, title, body: content, status: "DRAFT" } });
      await tx.announcementEvent.create({ data: { announcementId: current.id, action: "REVISED", details: `Version ${version} saved; approval reset.` } });
      const updated = await tx.announcement.update({ where: { id: current.id }, data: { title, body: content, category: clean(body.category, 60).toUpperCase() || current.category, source: clean(body.source, 180) || null, status: "DRAFT", publishedAt: null }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
      if (mutationId) await tx.syncMutation.upsert({ where: { id: mutationId }, create: { id: mutationId, entityType: "announcement", entityId: current.id, operation: "edit", payload: body as Prisma.InputJsonValue, appliedAt: new Date() }, update: { appliedAt: new Date() } });
      return updated;
    });
    return NextResponse.json({ announcement });
  }
  if (body.action === "approve") {
    if (current.status !== "DRAFT") return NextResponse.json({ error: "Only draft announcements can be approved" }, { status: 409 });
    if (placeholder.test(current.title) || placeholder.test(current.body)) return NextResponse.json({ error: "Resolve all [PLACEHOLDER] fields before approval" }, { status: 400 });
    const announcement = await db.$transaction(async (tx) => {
      const version = current.versions[0]?.version;
      if (version) await tx.announcementVersion.updateMany({ where: { announcementId: current.id, version }, data: { status: "APPROVED" } });
      await tx.announcementEvent.create({ data: { announcementId: current.id, action: "APPROVED", details: "Human approval recorded." } });
      return tx.announcement.update({ where: { id: current.id }, data: { status: "APPROVED" }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
    });
    return NextResponse.json({ announcement });
  }
  if (body.action === "publish") {
    if (current.status !== "APPROVED") return NextResponse.json({ error: "Approve the announcement before publishing" }, { status: 409 });
    const announcement = await db.$transaction(async (tx) => {
      const version = current.versions[0]?.version;
      if (version) await tx.announcementVersion.updateMany({ where: { announcementId: current.id, version }, data: { status: "PUBLISHED" } });
      await tx.announcementEvent.create({ data: { announcementId: current.id, action: "PUBLISHED", details: "Publication marked by administrator." } });
      return tx.announcement.update({ where: { id: current.id }, data: { status: "PUBLISHED", publishedAt: new Date() }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
    });
    return NextResponse.json({ announcement });
  }
  if (body.action === "archive") {
    const announcement = await db.$transaction(async (tx) => {
      const version = current.versions[0]?.version;
      if (version) await tx.announcementVersion.updateMany({ where: { announcementId: current.id, version }, data: { status: "ARCHIVED" } });
      await tx.announcementEvent.create({ data: { announcementId: current.id, action: "ARCHIVED", details: "Announcement archived." } });
      return tx.announcement.update({ where: { id: current.id }, data: { status: "ARCHIVED" }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
    });
    return NextResponse.json({ announcement });
  }
  if (body.action === "backToDraft") {
    const announcement = await db.$transaction(async (tx) => {
      const version = current.versions[0]?.version;
      if (version) await tx.announcementVersion.updateMany({ where: { announcementId: current.id, version }, data: { status: "DRAFT" } });
      await tx.announcementEvent.create({ data: { announcementId: current.id, action: "RETURNED_TO_DRAFT", details: "Publication state returned to draft." } });
      return tx.announcement.update({ where: { id: current.id }, data: { status: "DRAFT", publishedAt: null }, include: { versions: { orderBy: { version: "desc" } }, events: { orderBy: { createdAt: "desc" } } } });
    });
    return NextResponse.json({ announcement });
  }
  return NextResponse.json({ error: "Unsupported announcement action" }, { status: 400 });
}
export async function DELETE(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const primaryDenied = await requirePrimaryAdmin(); if (primaryDenied) return primaryDenied;
  const id = req.nextUrl.searchParams.get("id"); if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.announcement.deleteMany({ where: { id } }); return NextResponse.json({ ok: true });
}
