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

## Ava voice architecture

- **AI reasoning:** Ava sends chat requests to the configured xKiro-compatible endpoint through the server-side AI_BASE_URL, AI_API_KEY, and AI_MODEL settings.
- **Website speech-to-text:** the browser's Web Speech API (SpeechRecognition / webkitSpeechRecognition) handles transcription. It starts only after the user taps the microphone; no paid transcription API or server-side audio-upload route is used.
- **Android speech-to-text:** the native Android SpeechRecognizer is used, preferring Android's on-device recognizer when the device and installed language pack support it, with the platform recognition service as fallback. Microphone permission is requested only after the user taps Activate.
- **Spoken responses:** ElevenLabs is used when configured; browser speech synthesis and Android TextToSpeech provide device-native fallbacks.
- **Voice privacy:** the microphone is not activated automatically on page load or app launch. The user explicitly starts and ends each voice session.
## Application modules

1. Command centre and task overview
2. Academic assistant and grounded document retrieval
3. Lecture/course register and notes library
4. Announcement studio
5. Late-resumption catch-up centre
6. Private class administration and concerns register
7. Weekly reports, exports, and backups
8. Settings, provider configuration, and sync health

## Release status

The feature branch contains the completed website and native Android workflow work. Web CI and Android source/unit-test verification are being checked on the final commit. The production website is deployed through the existing Vercel project `afit-classdesk`; the intended production domain is `https://afit-classdesk.vercel.app/`. Android packaging remains a separate manual step and is not triggered by web deployment. Desktop/EXE packaging is out of scope.

## Local setup

1. Install Node.js 20.11+ and npm 10+.
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

## Ava background document tasks

Ava assignment-solution and study-summary PDFs are submitted as durable Vercel Workflows. The workflow stores task progress in PostgreSQL, retries failed processing steps, and saves generated PDFs through the configured S3-compatible object storage. A permanently running polling worker is not required on Vercel.

The production environment must provide the pooled/direct database URL, AI endpoint/key/model, and S3-compatible bucket, endpoint, access key, and secret key. The API checks these dependencies before accepting a background task. The legacy `npm run worker:ava` script remains available for local worker-based development only; it is not part of the Vercel production path.
