# AFIT ClassDesk — implementation status and release gates

This document is deliberately conservative. A route or screen existing in the repository does not mean its acceptance gate has passed. Release gates requiring a live database or browser test remain pending until CI runs successfully.

## M0 — Application foundation
- Next.js App Router, responsive shell and single-administrator authentication.
- PostgreSQL / Prisma persistence and S3-compatible object storage adapter.
- Health, JSON backup and DOCX export endpoints.
- Status: source implemented; clean install and production build still require CI verification.

## M1 — Academic records and document ingestion
- Generic class records with create/read/update/delete.
- PDF, DOCX, PPTX, TXT and Markdown extraction, text chunking and retrieval.
- File extension and signature checks, size limits, canonical MIME types, storage cleanup on database failure, original-file download when object storage is configured.
- Status: source implemented. English OCR supports image uploads and scanned PDFs (up to 20 pages). Optional ClamAV INSTREAM scanning is supported; configure CLAMAV_HOST and REQUIRE_MALWARE_SCAN for enforced scanning. Without a configured scanner, uploads are explicitly marked UNSCANNED.

## M2 — AI assistant and class drafting
- Server-side OpenAI-compatible Chat Completions adapter.
- Lexical retrieval from uploaded source chunks and structured academic records in generation context.
- Chat, announcement, weekly report, catch-up and study-summary prompts.
- Source titles returned to the interface; missing evidence must be identified rather than invented.
- Database-backed AI request throttling; no AI secret is exposed to the browser.
- Status: source implemented; provider integration requires real credentials and acceptance testing.

## M3 — Offline and synchronisation
- IndexedDB records and mutation outbox.
- Offline create, edit, status update and delete queueing for generic class records and academic workflow entities; offline announcement draft revisions; queued document uploads and AI prompts.
- Idempotent mutation receipts for records, announcement revisions and queued AI requests; stable upload IDs; bounded push batches, remote pull, deletion tombstones, server-side record versions and explicit local-vs-cloud conflict resolution.
- Status: source implemented. The acceptance gate still requires two-browser/device tests, airplane-mode recovery, refresh persistence and concurrent-edit conflict tests.
- AI execution is deferred until reconnection; AI itself is not available offline. Document uploads and draft creation queue locally. Announcement approval/publication still require connectivity.

## M4 — Academic workflow coverage
- Course catalogue.
- Lecture sessions with actual-held date, schedule, venue and summary.
- Assignment tracking, due dates, submission instructions and status.
- Aggregate attendance summaries (no student names or identifiers).
- Class concerns and resolution tracking.
- Dedicated announcement drafts, approval, publication, archive and version history.
- Catch-up and weekly DOCX exports from recorded data.
- Status: source implemented. Catch-up and weekly PDF and DOCX exports are included. Complete ZIP backups can include original files from object storage.

## M5 — Security, backup and release assurance
- Origin / Fetch Metadata checks for browser mutation requests.
- Database-backed atomic rate-limit buckets with hashed client keys and an in-memory fallback.
- Upload validation, server-side secret handling, bounded AI inputs, private backup export and explicit-confirmation merge restore.
- Complete ZIP backup includes searchable text, chunks, metadata and original files when object storage is configured. JSON-only backup remains available.
- CI workflow runs source checks, Prisma validation/generation, TypeScript, ESLint and production build.
- Status: source and CI workflow added. The clean install/build has NOT been verified in the current environment because npm registry DNS resolution failed. CI must pass before production release.

## M6 — Timetable and academic calendar
- Weekly recurring timetable entries with day, start/end time, venue and lecturer.
- iCalendar (`.ics`) export for dated events and weekly recurring class slots.
- Dated academic events for tests, examinations, deadlines and departmental activities.
- Calendar records use the existing versioned AcademicRecord sync path and can be created offline; no official AFIT schedule is assumed or imported.
- Status: source implemented; Prisma migration added. Database migration, offline conflict and browser acceptance tests remain pending.

## Production release gate
1. `npm install --no-audit --no-fund`
2. `npm run verify:source`
3. `npx prisma validate`
4. `npx prisma generate`
5. `npm run typecheck`
6. `npm run lint`
7. `npm run build`
8. Apply migrations to a disposable PostgreSQL database and test all CRUD, sync, upload, announcement approval, export and restore paths.
9. Test mobile layout and offline recovery in at least two browser contexts.

Never mark a gate complete without its test output. Do not deploy until the release gate passes.
