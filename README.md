# AFIT ClassDesk

Private academic administration and intelligence workspace for the ND1 Electrical/Electronics Engineering Technology class representative at the Air Force Institute of Technology (AFIT).

## Product goals

- Maintain an accurate record of lectures, topics covered, assignments, and verified deadlines.
- Ingest lecture documents and make them searchable for grounded AI assistance.
- Generate editable weekly announcements and class updates.
- Prepare catch-up packs for students who resume late or miss lectures.
- Maintain private class administration records with minimal personal data.
- Work offline for local drafts and queued changes, then synchronize when online.
- Keep the class representative in control: AI drafts; a human reviews and publishes.

## Deployment model

Hybrid PWA: online application with local offline drafts/queue. PostgreSQL is the authoritative shared database; browser storage is a temporary offline cache, not the only copy. AI and remote document processing require connectivity.

## Application modules

1. Command centre and task overview
2. Academic assistant and grounded document retrieval
3. Lecture/course register and notes library
4. Announcement studio
5. Late-resumption catch-up centre
6. Private class administration and concerns register
7. Weekly reports, exports, and backups
8. Settings, provider configuration, and sync health

## Repository status

The application source is present and being completed in phases. The current branch includes the two-account authentication model, academic records and document workflows, announcements, AI assistance, offline queues, shared PostgreSQL/object storage adapters, and role-aware permissions. The Ava voice interface is being updated to require explicit microphone activation. Git-based Vercel deployments are paused while implementation and verification continue. Do not treat the product as production-ready until the full test suite, production build, real database/object-storage checks, browser acceptance tests, and deployment smoke tests pass. A separate native Android project is now being developed in [`android/`](android/README.md), using Kotlin, Jetpack Compose and the shared authenticated API. The first native slice includes sign-in, dashboard, courses, assignments, encrypted offline snapshots, a sync outbox foundation and user-activated Ava voice. Android packaging and device acceptance tests are still pending. Desktop/EXE packaging is out of scope.

## Local setup

1. Install Node.js LTS and npm.
2. Copy `.env.example` to `.env.local`.
3. Configure the database, session secret, storage provider, and AI endpoint.
4. Install dependencies with `npm install`.
5. Generate the Prisma client and apply migrations using the documented scripts.
6. Run `npm run check` and `npm run build` before deployment.

Never commit `.env.local`, API keys, database URLs, student passwords, or private student records.

## Data protection principles

- Collect only information needed for legitimate class coordination.
- Do not publish phone numbers, matriculation identifiers, payment records, or private concerns in group announcements.
- Label AI-generated explanations separately from source lecture content.
- Show source document references where possible.
- Never invent official AFIT instructions, schedules, fees, deadlines, or lecturer statements.
- Obtain permission before sharing lecturer materials beyond their intended audience.

## Project identity

- Institution: Air Force Institute of Technology
- Department: Electrical/Electronics Engineering Technology
- Level: ND1
- Session: 2026/2027
- Access model: private, two authorised staff accounts (Class Representative and Assistant Class Representative)
- Primary communication channel: WhatsApp


## Two-account access

Production deployments must configure the two authorised accounts and session secret as described in [docs/ACCOUNT-SETUP.md](docs/ACCOUNT-SETUP.md). Public registration is disabled.
