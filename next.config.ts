import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { existsSync, readFileSync } from "node:fs";
// Development conveniences only; production credentials must arrive at runtime.
if (process.env.NODE_ENV !== "production") {
  try {
    const file = "keys/API-KEYS.env";
    if (existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith("#")) continue;
      const v = m[2].replace(/^"(.*)"$/, "$1"); if (v && !process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* ignore */ }
}
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }
];
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "tesseract.js", "@napi-rs/canvas", "@prisma/client", "@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  output: "standalone",
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }
    ];
  }
};
export default withWorkflow(nextConfig);
