import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { assertSameOrigin, rateLimit, clientIp } from "@/lib/http";
import { start } from "workflow/api";
import { processAvaTaskWorkflow } from "@/lib/ava/workflows";

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
  // Workflow runs are managed by Vercel; no separate heartbeat process is required.
  return NextResponse.json({ tasks, workerOnline: true, processingMode: "vercel-workflows" });
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
  const rawDocumentIds: unknown[] = Array.isArray(body?.documentIds) ? body.documentIds : [];
  const documentIds: string[] = Array.from(new Set(
    rawDocumentIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 80)
  )).slice(0, 10);
  if (!documentIds.length) return NextResponse.json({ error: "Select at least one uploaded document." }, { status: 400 });
  const documents = await db.document.findMany({
    where: { id: { in: documentIds }, status: "READY" },
    select: { id: true, title: true }
  });
  if (documents.length !== documentIds.length) {
    return NextResponse.json({ error: "One or more selected documents are unavailable or not ready for processing." }, { status: 404 });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  const clientRequestId = typeof body?.clientRequestId === "string" ? body.clientRequestId : "";
  if (clientRequestId && !/^[a-f0-9-]{36}$/i.test(clientRequestId)) {
    return NextResponse.json({ error: "Invalid task request ID." }, { status: 400 });
  }

  if (clientRequestId) {
    const existing = await db.aiTask.findFirst({
      where: { id: clientRequestId, ownerId: user.id },
      select: { id: true, kind: true, status: true, progress: true, currentStep: true, createdAt: true }
    });
    if (existing) {
      // Safe recovery for a task row created just before a request was interrupted.
      if (existing.status === "QUEUED") {
        try { await start(processAvaTaskWorkflow, [existing.id, user.id]); }
        catch (error) {
          console.error("[Ava] Could not enqueue existing task", existing.id, error);
          return NextResponse.json({ error: "Ava could not accept the task yet. Please retry shortly." }, { status: 503 });
        }
      }
      return NextResponse.json({ task: existing, duplicate: true }, { status: 200 });
    }
  }

  const task = await db.aiTask.create({
    data: {
      id: clientRequestId || randomUUID(),
      ownerId: user.id,
      ownerUsername: user.username,
      kind,
      status: "QUEUED",
      input: { documentIds, prompt } as Prisma.InputJsonValue,
      currentStep: "Submitting to Vercel background processing"
    },
    select: { id: true, kind: true, status: true, progress: true, currentStep: true, createdAt: true }
  });

  try {
    const run = await start(processAvaTaskWorkflow, [task.id, user.id]);
    await db.aiTask.updateMany({
      where: { id: task.id, ownerId: user.id, status: "QUEUED" },
      data: { currentStep: "Queued on Vercel durable processing" }
    });
    return NextResponse.json({ task, workflowRunId: run.runId, message: "Ava task queued. It will continue even if the voice panel is closed." }, { status: 202 });
  } catch (error) {
    console.error("[Ava] Workflow enqueue failed", task.id, error);
    await db.aiTask.updateMany({
      where: { id: task.id, ownerId: user.id, status: "QUEUED" },
      data: { status: "FAILED", currentStep: "Could not enqueue task", errorMessage: "Vercel background processing could not accept this task. Please retry.", completedAt: new Date() }
    });
    return NextResponse.json({ error: "Ava background processing is temporarily unavailable. Your task was not left queued." }, { status: 503 });
  }
}
