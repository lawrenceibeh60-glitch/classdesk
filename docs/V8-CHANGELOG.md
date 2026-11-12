# AFIT ClassDesk v8 changelog

## Academic calendar and weekly timetable
- Added a dedicated calendar and timetable workspace.
- Added dated events with category, start/end time, venue and notes.
- Added recurring weekly class slots with day, start/end time, venue and lecturer.
- The calendar automatically brings in open assignment deadlines and scheduled lecture sessions, linking back to their source modules.
- Added iCalendar export for custom events, assignment deadlines, scheduled lectures and recurring timetable slots.
- Added `CALENDAR` and `TIMETABLE` AcademicRecord types with a forward-only Prisma enum migration.
- Calendar and timetable entries use the existing IndexedDB queue, server versioning and conflict-aware sync path.
- No official AFIT schedule or academic dates are preloaded or inferred.

## Validation
- Source implementation only. Dependencies were not installed and no typecheck, lint, build, database migration or browser acceptance tests were run in this delivery.
