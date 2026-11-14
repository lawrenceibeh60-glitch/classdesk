import { NextRequest, NextResponse } from "next/server";
import { requireStaff, assertSameOrigin, rateLimit, clientIp } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req); if (originDenied) return originDenied;
  const denied = await requireStaff(); if (denied) return denied;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "No ElevenLabs key; using the PC voice." }, { status: 501 });
  if (!(await rateLimit(`tts:${clientIp(req)}`, 400, 60 * 60 * 1000))) return NextResponse.json({ error: "Voice limit reached." }, { status: 429 });
  const body = await req.json().catch(() => null); const text = String(body?.text || "").trim().slice(0, 700);
  if (!text) return NextResponse.json({ error: "Text is required" }, { status: 400 });
  const voice = encodeURIComponent(process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku");
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" }, cache: "no-store",
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8 } })
    });
    if (!r.ok) return NextResponse.json({ error: `Voice service returned ${r.status}` }, { status: 502 });
    return new NextResponse(new Uint8Array(await r.arrayBuffer()), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Voice service unreachable" }, { status: 502 }); }
}
