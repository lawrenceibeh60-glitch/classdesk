# AFIT ClassDesk — Architecture

## Product boundary
A private, single-administrator academic coordination workspace for an AFIT ND1 Electrical/Electronics Engineering Technology class representative (2026/2027). It is not an AFIT-owned system, official student portal, official source of departmental directives, or replacement for lecturer communication.

## Runtime model
- **Application:** Next.js App Router, React and TypeScript.
- **Database:** PostgreSQL via Prisma and the PostgreSQL adapter.
- **Files:** private S3-compatible object storage for original uploads; extracted text and searchable chunks live in PostgreSQL.
- **AI:** server-side OpenAI-compatible Chat Completions endpoint.
- **Offline:** PWA shell cache and Dexie / IndexedDB queues for class records, academic workflows, announcement drafts, document uploads and deferred AI requests.

## Domain modules
- `AcademicRecord`: general class activities and administrative notes, including dated calendar events and recurring timetable slots.
- `Course`: course code, name, lecturer, semester and active status.
- `LectureSession`: scheduled/held dates, topic, venue and verified summary.
- `Assignment`: details, deadline, submission instructions and progress status.
- `AttendanceSummary`: aggregate present/absent counts only; no student identities.
- `ClassConcern`: issue tracking and resolution status.
- `Document` / `DocumentChunk`: source files, extracted text and lexical retrieval chunks.
- `Announcement` / `AnnouncementVersion` / `AnnouncementEvent`: drafts, human approval, publication, archival, content revisions and status audit events.
- `SyncMutation`: idempotency receipts for class records and announcement revisions; record deletion tombstones. `AcademicRecord.version` is the optimistic concurrency token. `AIRequestReceipt`: short-lived response receipts for queued AI requests.
- `RateLimitBucket`: atomic database-backed request throttling.

## Data lifecycle
1. The administrator uploads a supported document.
2. The server checks the extension, file signature and size; extracts selectable text; stores the original in object storage if configured; and persists text/chunks in PostgreSQL.
3. The assistant retrieves matching chunks and includes structured course, lecture, assignment and concern records where relevant.
4. The server calls the configured AI provider. The response includes source titles; absent evidence is explicitly disclosed.
5. AI output is a draft. Announcement publication requires a separate human approval step.
6. Records and academic workflow changes created offline enter local queues. Sync pushes idempotent mutations, reports stale-write conflicts for generic records, and pulls cloud updates and deletion tombstones. Uploads and AI prompts are deferred until connectivity returns.

## Calendar and timetable
- Calendar events and weekly timetable slots are stored as versioned `AcademicRecord` entries (`CALENDAR` and `TIMETABLE`).
- Event dates are absolute timestamps; recurring timetable slots store day-of-week and local start/end times in metadata.
- Entries use the same IndexedDB outbox, optimistic concurrency and conflict handling as generic records.
- The app does not infer or claim official AFIT class times; the administrator must enter confirmed information.

## Offline boundaries
- Generic class records support local create, edit, status change and delete queueing with server-version conflict handling.
- Academic workflow entities and announcement drafts queue locally; announcement approval/publication still require connectivity.
- Document uploads are stored as local blobs with stable IDs and uploaded after reconnecting.
- AI requests are queued and executed after reconnecting; model inference itself is not offline.
- Push/pull sync is eventual consistency, not real-time collaborative editing. Browser/device acceptance testing is still required.

## Security and privacy
- Single administrator session: HS256 JWT in an HttpOnly, SameSite=Lax cookie; Secure in production.
- Prefer `ADMIN_PASSWORD_HASH` over `ADMIN_PASSWORD`.
- `SESSION_SECRET`, AI credentials and S3 credentials are server-only.
- Mutation endpoints check Origin and Fetch Metadata when provided; login, AI and upload operations are throttled.
- Uploads are capped by `MAX_UPLOAD_MB`, restricted by extension and signature, and stored under generated object keys.
- Attendance is aggregate-only. Do not store passwords, payment details, JAMB credentials, medical details or unnecessary student identifiers.
- The application is a personal tool, not an official AFIT service.

## Retrieval limitations
Current retrieval is lexical matching over stored chunks. It is not vector search, and `AI_EMBEDDING_MODEL` is not used. OCR supports English image uploads and scanned PDFs with a configurable page limit. Optional ClamAV INSTREAM scanning is supported; files are marked UNSCANNED when no scanner is configured.

## Backup boundaries
The complete ZIP backup includes records, academic workflows, announcement versions/events, extracted document text/chunks and original file bytes readable from configured object storage. JSON-only backup omits original file bytes. Backups are not encrypted by the application; store them securely. Restore merges by stable IDs and requires explicit confirmation; it does not delete unrelated live data.

## Deployment
- Vercel for the Next.js application.
- Neon or another managed PostgreSQL provider for `DATABASE_URL`.
- Private S3-compatible storage for original files.
- Server-side AI provider configured through `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`.
- Apply reviewed migrations with `npx prisma migrate deploy` before serving.


## Document OCR and malware scanning

- Image notes (PNG/JPEG/WEBP) are OCR-processed with Tesseract.js using English language data.
- PDFs first use text extraction. If extracted text is effectively empty, up to 20 pages are rendered with PDF.js and `@napi-rs/canvas`, then OCR-processed.
- OCR runs server-side and can increase CPU time and memory use; keep upload limits conservative on serverless hosts.
- Uploads can be scanned by a private ClamAV daemon through the INSTREAM protocol using `CLAMAV_HOST` and `CLAMAV_PORT`. When configured, scanner failures fail the upload closed. Set `REQUIRE_MALWARE_SCAN=true` to reject all uploads when ClamAV is not configured.
- `securityScanStatus` records CLEAN or UNSCANNED. A missing scanner is not represented as a clean scan.

## Complete backups

`/api/export/archive` creates a ZIP containing the JSON data manifest and original uploaded files readable from configured object storage. Restore accepts JSON or ZIP and restores original bytes only when object storage is configured. Backups are not encrypted; operators must store them in a private location.


## Offline queues

IndexedDB stores generic records, academic workflow entries, announcement drafts, upload blobs and AI requests. When connectivity returns, each workspace can flush its relevant queue; the dashboard can also coordinate all queues. Record sync uses server versions and explicit conflict resolution. Academic entries use stable IDs and idempotent upserts; announcement edits use mutation receipts; document uploads use stable UUIDs; AI requests use short-lived server receipts to avoid repeat provider calls after a lost response. AI generation itself requires a live connection.
