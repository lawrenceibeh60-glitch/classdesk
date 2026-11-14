import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";

const COOKIE = "classdesk_session";
const ISSUER = "afit-classdesk";
const AUDIENCE = "afit-classdesk";
const SESSION_SECONDS = 60 * 60 * 12;

export type UserRole = "CLASS_REP" | "ASSISTANT_REP";
export type SessionUser = {
  id: "class-rep" | "assistant-rep";
  username: string;
  displayName: string;
  role: UserRole;
};

type CredentialAccount = SessionUser & { passwordHash: string };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function accountConfig(): CredentialAccount[] {
  const classRepHash = process.env.CLASS_REP_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || "";
  const assistantHash = process.env.ASSISTANT_REP_PASSWORD_HASH || "";
  const classRepUsername = (process.env.CLASS_REP_USERNAME || "classrep").trim().toLowerCase();
  const assistantUsername = (process.env.ASSISTANT_REP_USERNAME || "assistantrep").trim().toLowerCase();

  if (!classRepHash || !assistantHash) {
    throw new Error("Configure CLASS_REP_PASSWORD_HASH and ASSISTANT_REP_PASSWORD_HASH before enabling ClassDesk sign-in");
  }
  if (classRepUsername.length < 3 || assistantUsername.length < 3 || classRepUsername === assistantUsername) {
    throw new Error("ClassDesk account usernames must be distinct and contain at least 3 characters");
  }

  return [
    { id: "class-rep", username: classRepUsername, displayName: "Class Representative", role: "CLASS_REP", passwordHash: classRepHash },
    { id: "assistant-rep", username: assistantUsername, displayName: "Assistant Class Representative", role: "ASSISTANT_REP", passwordHash: assistantHash },
  ];
}

export async function authenticateCredentials(username: string, password: string): Promise<SessionUser | null> {
  const normalized = username.trim().toLowerCase();
  const accounts = accountConfig();
  const account = accounts.find((item) => safeEqual(item.username, normalized));
  if (!account) {
    // Perform a password-hash operation for unknown usernames to reduce timing differences.
    await bcrypt.compare(password, accounts[0].passwordHash);
    return null;
  }
  const valid = await bcrypt.compare(password, account.passwordHash);
  if (!valid) return null;
  const { passwordHash: _passwordHash, ...user } = account;
  return user;
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ username: user.username, displayName: user.displayName, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      (payload.role !== "CLASS_REP" && payload.role !== "ASSISTANT_REP") ||
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.displayName !== "string"
    ) return null;
    return {
      id: payload.sub as SessionUser["id"],
      username: payload.username,
      displayName: payload.displayName,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function isAuthenticated() {
  return Boolean(await getSession());
}

