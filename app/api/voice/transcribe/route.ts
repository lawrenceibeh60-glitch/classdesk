import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, assertSameOrigin, rateLimit, clientIp } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireAdmin(); if (denied) return denied;
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return NextResponse.json({ error: "Add MISTRAL_API_KEY to keys/API-KEYS.env to enable voice listening." }, { status: 501 });
  if (!(await rateLimit(`stt:${clientIp(req)}`, 600, 60 * 60 * 1000))) return NextResponse.json({ error: "Voice limit reached. Try again later." }, { status: 429 });
  try {
    const form = await req.formData(); const file = form.get("file");
    if (!(file instanceof File) || file.size < 1) return NextResponse.json({ error: "No audio received" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Audio clip too long" }, { status: 413 });
    const out = new FormData();
    out.append("file", file, "speech.wav"); out.append("model", process.env.MISTRAL_VOICE_MODEL || "voxtral-mini-latest"); out.append("language", "en");
    const r = await fetch("https://api.mistral.ai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: out, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ error: data?.message || data?.error?.message || `Speech service returned ${r.status}` }, { status: 502 });
    return NextResponse.json({ text: String(data.text || "").trim() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 502 }); }
}
