import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET() {
  let databaseReachable = false;
  const databaseConfigured = Boolean(process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL);
  if (databaseConfigured) {
    try {
      const { db } = await import("@/lib/db");
      await db.$queryRaw`SELECT 1`;
      databaseReachable = true;
    } catch { databaseReachable = false; }
  }
  const storageConfigured = Boolean(
    (process.env.NODE_ENV !== "production" && process.env.LOCAL_STORAGE_DIR) ||
    (process.env.S3_BUCKET &&
      (process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID) &&
      (process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY) &&
      (process.env.AWS_ENDPOINT_URL_S3 || process.env.S3_ENDPOINT))
  );
  const headers = { "Cache-Control": "no-store" };
  if (!(await isAuthenticated())) return NextResponse.json({ ok: databaseReachable }, { status: databaseReachable ? 200 : 503, headers });
  return NextResponse.json({
    ok: databaseReachable,
    app: "AFIT ClassDesk",
    timestamp: new Date().toISOString(),
    databaseConfigured,
    databaseReachable,
    storageConfigured,
    aiConfigured: Boolean((process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL) || process.env.MISTRAL_API_KEY),
    sttConfigured: Boolean(process.env.MISTRAL_API_KEY),
    ttsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    malwareScannerConfigured: Boolean(process.env.CLAMAV_HOST),
    malwareScanRequired: process.env.REQUIRE_MALWARE_SCAN === "true",
    ocrEnabled: true,
  }, { status: databaseReachable ? 200 : 503, headers });
}
