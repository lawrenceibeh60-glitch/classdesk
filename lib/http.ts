import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function requireStaff() {
  if (!(await getSession())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return null;
}

export async function requireAdmin() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "CLASS_REP") return NextResponse.json({ error: "This action is restricted to the Class Representative" }, { status: 403 });
  return null;
}

export function assertSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).origin !== new URL(req.url).origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  } catch { return NextResponse.json({ error: "Invalid request origin" }, { status: 403 }); }
  return null;
}

const fallbackAttempts = new Map<string, { count: number; reset: number }>();
export async function rateLimit(key: string, max = 5, windowMs = 15 * 60 * 1000) {
  const now = new Date(); const resetAt = new Date(now.getTime() + windowMs);
  const hashedKey = createHash("sha256").update(key).digest("hex");
  try {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "createdAt", "updatedAt")
      VALUES (${hashedKey}, 1, ${resetAt}, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
        "updatedAt" = ${now}
      RETURNING "count"
    `;
    return (rows[0]?.count ?? max + 1) <= max;
  } catch {
    const hit = fallbackAttempts.get(hashedKey); const time = Date.now();
    if (!hit || hit.reset < time) { fallbackAttempts.set(hashedKey, { count: 1, reset: time + windowMs }); return true; }
    hit.count += 1; return hit.count <= max;
  }
}
export function clientIp(req: Request) {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
}
