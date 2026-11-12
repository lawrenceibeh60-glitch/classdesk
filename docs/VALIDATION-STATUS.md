# Validation status for AFIT ClassDesk v8 source

The v8 implementation extends the v7 source with the calendar and timetable module. Dependency-backed validation has not been run for v8. The developer is expected to run the documented release checks after installing dependencies and configuring PostgreSQL.

## Environment limitation previously encountered
- The earlier dependency installation attempt failed because `registry.npmjs.org` DNS resolution returned `EAI_AGAIN`.
- A production build, Prisma client generation, migration application (including the new RecordType enum migration), browser/mobile acceptance and multi-device sync testing have not been certified for this v8 package.

**Release status: NOT VERIFIED FOR PRODUCTION.** Do not deploy until `npm install`, Prisma validation/generation, TypeScript, ESLint, production build, database migration tests, and browser/offline acceptance tests pass.
