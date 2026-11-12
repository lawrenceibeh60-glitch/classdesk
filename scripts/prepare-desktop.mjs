import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
const sa = ".next/standalone";
if (!existsSync(`${sa}/server.js`)) throw new Error("Run `next build` first (standalone output missing).");
cpSync(".next/static", `${sa}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${sa}/public`, { recursive: true });
for (const f of [".env", ".env.local"]) rmSync(`${sa}/${f}`, { force: true }); // never ship secrets
rmSync("desktop/payload", { recursive: true, force: true }); mkdirSync("desktop/payload", { recursive: true });
cpSync(sa, "desktop/payload/server", { recursive: true });
cpSync("prisma/migrations", "desktop/payload/migrations", { recursive: true });
rmSync("desktop/payload/server/keys", { recursive: true, force: true });
console.log("Desktop bundle prepared.");
