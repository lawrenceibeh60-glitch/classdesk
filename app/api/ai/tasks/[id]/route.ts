import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const task = await db.aiTask.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, kind: true, status: true, progress: true, currentStep: true, output: true, errorMessage: true, resultDocumentId: true, createdAt: true, startedAt: true, completedAt: true, updatedAt: true }
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const result = await db.aiTask.updateMany({
    where: { id, ownerId: user.id, status: "QUEUED" },
    data: { status: "CANCELLED", currentStep: "Cancelled by user", completedAt: new Date() }
  });
  if (!result.count) return NextResponse.json({ error: "Task was not found or has already started." }, { status: 409 });
  return NextResponse.json({ ok: true, status: "CANCELLED" });
}
