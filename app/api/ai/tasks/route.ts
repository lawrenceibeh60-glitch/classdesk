import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertSameOrigin, rateLimit, clientIp } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const tasks = await db.aiTask.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, kind: true, status: true, progress: true, currentStep: true, errorMessage: true, resultDocumentId: true, createdAt: true, startedAt: true, completedAt: true, updatedAt: true }
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!(await rateLimit(`ava-task:${user.id}:${clientIp(req)}`, 10, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Ava task limit reached. Try again later." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const kind = String(body?.kind || "");
  if (!["assignment_pdf", "study_summary_pdf"].includes(kind)) {
    return NextResponse.json({ error: "Supported tasks: assignment_pdf and study_summary_pdf." }, { status: 400 });
  }
  const documentIds = Array.isArray(body?.documentIds)
    ? [...new Set(body.documentIds.filter((id: unknown): id is string => typeof id === "string" && id.length <= 80))].slice(0, 10)
    : [];
  if (!documentIds.length) return NextResponse.json({ error: "Select at least one uploaded document." }, { status: 400 });
  const documents = await db.document.findMany({
    where: { id: { in: documentIds }, status: "READY" },
    select: { id: true, title: true }
  });
  if (documents.length !== documentIds.length) {
    return NextResponse.json({ error: "One or more selected documents are unavailable or not ready for processing." }, { status: 404 });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  const task = await db.aiTask.create({
    data: {
      id: randomUUID(),
      ownerId: user.id,
      ownerUsername: user.username,
      kind,
      status: "QUEUED",
      input: { documentIds, prompt } ,
      currentStep: "Waiting for an Ava worker",
    },
    select: { id: true, kind: true, status: true, progress: true, currentStep: true, createdAt: true }
  });
  return NextResponse.json({ task, message: "Ava task queued. It will continue even if the voice panel is closed." }, { status: 202 });
}
