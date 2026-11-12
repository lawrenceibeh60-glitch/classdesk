import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
const COOKIE = "classdesk_session";
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function verifyAdminPassword(password: string) {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash) return bcrypt.compare(password, hash);
  const configured = process.env.ADMIN_PASSWORD;
  return Boolean(configured && configured !== "change-this-before-first-run" && safeEqual(password, configured));
}
export async function createSession() {
  const token = await new SignJWT({ role: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuer("afit-classdesk").setAudience("afit-classdesk").setIssuedAt().setExpirationTime("7d").sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
}
export async function destroySession() {
  const jar = await cookies(); jar.delete(COOKIE);
}
export async function isAuthenticated() {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return false;
    const { payload } = await jwtVerify(token, secret(), { issuer: "afit-classdesk", audience: "afit-classdesk", algorithms: ["HS256"] });
    return payload.role === "admin";
  } catch { return false; }
}
