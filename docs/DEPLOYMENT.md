# Deployment guide

## Requirements
- Node.js 22 (Node 20.11+ supported) and npm 10+.
- PostgreSQL database.
- A private S3-compatible bucket if original document downloads are required.
- An OpenAI-compatible Chat Completions endpoint for AI features.

## Environment variables
Set these in the deployment provider, never in browser-visible `NEXT_PUBLIC_*` variables:
- `DATABASE_URL`: PostgreSQL connection string with provider-recommended TLS settings.
- `SESSION_SECRET`: cryptographically random value of at least 32 characters.
- `ADMIN_PASSWORD_HASH`: bcrypt hash for the administrator password. Prefer this to plain `ADMIN_PASSWORD`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: optional private object storage. Without these, extracted text is stored but original files cannot be downloaded.
- `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`: required for AI. `AI_BASE_URL` is the API base ending before `/chat/completions`.
- `MAX_UPLOAD_MB`: optional upload cap, clamped to 1–50 MB (default 20).
- `AI_REQUEST_TIMEOUT_MS`: optional model timeout (default 60 seconds).
- `CLAMAV_HOST`, `CLAMAV_PORT`: optional private ClamAV daemon endpoint using INSTREAM. If configured, scanner failures reject uploads. Set `REQUIRE_MALWARE_SCAN=true` to fail closed when no scanner is configured.
- `OCR_MAX_PAGES`: maximum scanned PDF pages OCR will process (1–20, default 8) to bound CPU and memory use.

## Install and validate
```bash
npm install --no-audit --no-fund
npm run verify:source
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm run build
```

## Database migration
For a new production database:
```bash
npx prisma migrate deploy
```
Do not use `prisma db push` for a production database with migration history. Review migrations before applying them to the live database.

## Vercel
1. Import the repository and select its root directory.
2. Set Node.js 22 and all required environment variables.
3. Ensure the Neon database is reachable from the deployment region.
4. Run migrations before enabling traffic (or use a controlled release job).
5. Verify `/api/health`, sign-in, course/assignment CRUD, upload/download, AI, announcement approval, backup and restore.
6. Do not expose the admin URL or credentials publicly.

## Backup and restore
Download the complete ZIP backup from Settings. It contains class data, extracted document text, chunks, and original uploaded files available in object storage. JSON-only backup contains searchable text and metadata. Restore merges matching IDs and requires typing `RESTORE_CLASSDESK_BACKUP`; test restore against a disposable database before relying on it. Backups are not encrypted.

## Offline testing
Install the PWA, create and edit class records, academic entries and announcement drafts while offline, queue document uploads and AI requests, refresh, reconnect and sync. Repeat from a second browser context to verify remote pulls, deletion tombstones and conflict handling. AI execution and announcement approval/publication require connectivity.

## Windows desktop release
Build the x64 NSIS installer on Windows with Node.js 22 and npm:

```powershell
$env:DATABASE_URL = "postgresql://classdesk:classdesk@127.0.0.1:5432/classdesk"
npm install --no-audit --no-fund
npm run desktop:build
```

The installer is `dist-desktop/AFIT-ClassDesk-Setup.exe`. The desktop app runs its Next.js server and embedded PostgreSQL locally; it does not require an installed Node.js or PostgreSQL service. Its database, uploaded files and stable loopback port persist under `%APPDATA%/AFIT ClassDesk`, keeping offline browser storage available across restarts. The private config is `%APPDATA%/AFIT ClassDesk/xkiro keys/key.cd`. The first launch creates this blank config; enter an administrator password (prefer `ADMIN_PASSWORD_HASH`) before starting again. No repository API-key file is included in the installer.

Create complete application backups from Settings while signed in. For a raw data-folder copy, fully exit ClassDesk first so PostgreSQL has shut down cleanly. Uninstalling the application intentionally preserves this user data.

The `Windows desktop release` GitHub Actions workflow builds the installer on a clean Windows runner and tests install, first start, database initialization and persistence across restart, graceful exit, and uninstall. A Windows runner or VM is required for these checks; a Linux build alone does not certify the NSIS installer.
