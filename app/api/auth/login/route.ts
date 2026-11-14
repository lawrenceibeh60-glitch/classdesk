import { NextRequest, NextResponse } from "next/server";
import { authenticateCredentials, createSession } from "@/lib/auth";
import { rateLimit, clientIp, assertSameOrigin } from "@/lib/http";

export async function POST(req: NextRequest) {
  const originDenied = assertSameOrigin(req);
  if (originDenied) return originDenied;
  try {
    if (!(await rateLimit(`login:${clientIp(req)}`, 8))) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    if (
      typeof body?.username !== "string" || body.username.trim().length < 3 || body.username.length > 80 ||
      typeof body?.password !== "string" || body.password.length < 1 || body.password.length > 256
    ) {
      return NextResponse.json({ error: "Enter your username and password" }, { status: 400 });
    }
    const user = await authenticateCredentials(body.username, body.password);
    if (!user) return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
    await createSession(user);
    return NextResponse.json({ ok: true, user: { username: user.username, displayName: user.displayName, role: user.role } });
  } catch (error) {
    console.error("login failed", error);
    return NextResponse.json({ error: "Sign-in is not configured correctly. Contact the primary administrator." }, { status: 503 });
  }
}
