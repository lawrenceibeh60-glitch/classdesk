import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, clientIp, rateLimit, requireStaff } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/m4a", "audio/wav",
  "audio/x-wav", "audio/mpeg", "audio/aac", "audio/flac", "audio/3gpp"
]);

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;
  const denied = await requireStaff();
  if (denied) return denied;

  if (!(await rateLimit(`ava-stt:${clientIp(req)}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Ava voice usage limit reached. Please wait before recording again." }, { status: 429 });
  }

  const endpoint = process.env.WHISPER_API_URL?.trim();
  if (!endpoint) {
    return NextResponse.json({ error: "Cloud transcription is not configured. Use a browser with built-in speech recognition or type to Ava." }, { status: 503 });
  }

  let target: URL;
  try {
    target = new URL(endpoint);
    if (target.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(target.hostname))) {
      return NextResponse.json({ error: "The transcription endpoint must use HTTPS." }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ error: "WHISPER_API_URL is not a valid URL." }, { status: 503 });
  }

  try {
    const incoming = await req.formData();
    const audio = incoming.get("file");
    if (!(audio instanceof File)) return NextResponse.json({ error: "An audio recording is required." }, { status: 400 });
    if (audio.size < 1 || audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Audio must be between 1 byte and 20 MB." }, { status: 413 });
    const mimeType = audio.type.toLowerCase().split(";")[0].trim();
    if (!ALLOWED_TYPES.has(mimeType)) return NextResponse.json({ error: "Unsupported audio format. Record using WebM, Ogg, MP4, WAV, AAC, FLAC or MP3." }, { status: 415 });

    const payload = new FormData();
    payload.set("file", audio, audio.name || "ava-recording.webm");
    // whisper.cpp loads its model at process startup; it does not need an API model field.
    payload.set("response_format", "json");
    payload.set("language", "en");

    const headers = new Headers();
    const apiKey = process.env.WHISPER_API_KEY?.trim();
    if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: payload,
      cache: "no-store",
      signal: AbortSignal.timeout(55_000)
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: upstream.status === 429 ? "The transcription service is busy. Try again shortly." : "The transcription service could not process this recording." }, { status: upstream.status === 429 ? 429 : 502 });
    }
    const result: unknown = await upstream.json();
    const text = result && typeof result === "object" && "text" in result && typeof result.text === "string" ? result.text.trim() : "";
    if (!text) return NextResponse.json({ error: "No speech was recognised. Try speaking a little closer to the microphone." }, { status: 422 });
    return NextResponse.json({ text: text.slice(0, 8000) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "Transcription took too long. Please try a shorter recording." : "Could not reach the transcription service." }, { status: 502 });
  }
}
