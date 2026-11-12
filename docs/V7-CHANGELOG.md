# AFIT ClassDesk v7 — implementation additions

This release extends the v6 codebase in place. It does not replace the application with a new starter template.

## Academic coverage
- Added the missing `/coverage` page and course-by-course view of sessions recorded as held and searchable materials linked to courses.
- Added the coverage page to the PWA navigation cache.

## Documents and security
- Added English OCR for PNG, JPEG, WEBP and scanned PDFs. PDF OCR is bounded by `OCR_MAX_PAGES` (default 8, maximum 20).
- Added optional ClamAV INSTREAM scanning. Configure `CLAMAV_HOST` and `CLAMAV_PORT`; set `REQUIRE_MALWARE_SCAN=true` to reject uploads when no scanner is configured.
- Added explicit `securityScanStatus` values so unscanned files are never represented as clean.
- Added stable UUID upload IDs so a retried offline upload does not create duplicate document rows.
- The document list now identifies whether the original file is actually retained in object storage.

## Reports and backup
- Added weekly and catch-up PDF exports alongside DOCX exports.
- Added complete ZIP backup export with searchable data and original files accessible from object storage.
- ZIP restore can restore original file bytes when S3-compatible storage is configured. JSON restore remains supported.
- Added archive size, entry-count and per-file restore limits.

## Offline workflows
- Extended IndexedDB to cache and queue courses, lectures, assignments, attendance summaries and class concerns.
- Added offline announcement draft creation/revision and deletion queueing. Approval, publication and archive actions still require connectivity.
- Added offline document upload queueing and reconnection upload.
- Added deferred AI chat/generation requests and result recovery. AI inference itself still requires connectivity.
- Added short-lived AI request receipts to avoid repeating provider calls when a queued request is retried after a lost response.

## Database migrations
- `202611100005_document_security_scan`
- `202611100006_ai_request_receipts`

## Release caveat
The authoring environment could not complete dependency installation because npm registry DNS resolution failed earlier. Run the documented install, Prisma, typecheck, lint, build, migration, and browser acceptance steps before deployment.
