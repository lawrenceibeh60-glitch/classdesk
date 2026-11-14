import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
