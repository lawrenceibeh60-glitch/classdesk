import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readObject } from "@/lib/storage";
import { requireAdmin } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const { id } = await context.params;
  const doc = await db.document.findUnique({ where: { id }, select: { filename: true, mimeType: true, storageKey: true } });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  if (!doc.storageKey) return NextResponse.json({ error: "Original file is not available. Searchable extracted text remains stored in ClassDesk." }, { status: 404 });
  try {
    const bytes = await readObject(doc.storageKey);
    const filename = doc.filename.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": doc.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${filename}"`, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Original file could not be retrieved from object storage" }, { status: 502 }); }
}
