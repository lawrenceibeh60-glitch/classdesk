# Data model

- `AcademicRecord`: versioned typed records for class activities, administrative notes, dated calendar events and recurring weekly timetable slots. Calendar and timetable details are held in bounded JSON metadata.
- `Course`: course catalogue and relationships to lecture sessions, assignments and attendance summaries.
- `LectureSession`: scheduled/held lecture dates, course, venue, lecturer, topic and verified summary.
- `Assignment`: due dates, submission instructions and progress status.
- `AttendanceSummary`: aggregate present/absent counts only; no student identities.
- `ClassConcern`: issue tracking and resolution status.
- `Document`: original file metadata, extracted text, course/topic/date tags, processing state, security-scan status and object-storage key.
- `DocumentChunk`: bounded text passages used for lexical retrieval and source attribution.
- `Announcement`, `AnnouncementVersion` and `AnnouncementEvent`: draft, approval, publication, archive, version history and audit events.
- `SyncMutation`: idempotency ledger for offline mutations, record deletion tombstones and optimistic concurrency.
- `AiRequestReceipt`: short-lived idempotency receipts for AI requests.
- `RateLimitBucket`: database-backed request throttling.

Calendar entries and timetable slots are stored as `AcademicRecord` values so they share the existing offline queue and version-aware sync behavior. Assignment due dates and scheduled lectures are projected into the calendar as read-only linked items; their source data remains in the academic workflow tables.

Student records should be minimal. Avoid sensitive personal identifiers and never use the application as an unofficial student result or fee database.
