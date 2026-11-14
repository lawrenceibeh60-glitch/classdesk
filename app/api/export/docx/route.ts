import { NextRequest, NextResponse } from "next/server";
import { requireStaff, assertSameOrigin } from "@/lib/http";
import { markdownToDocx } from "@/lib/docx-export";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;

  const denied = await requireStaff();
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.slice(0, 100_000) : "";
  if (!content.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
  const title = String(body?.title || "ClassDesk draft").slice(0, 120);
  const buffer = await markdownToDocx(title, content);
  const safe = title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "classdesk";
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${safe}.docx"` } });
}
