# AFIT ClassDesk Android

Native Android client workspace for the existing ClassDesk service.

## Architecture

- Kotlin + Jetpack Compose native screens and navigation shell.
- Retrofit + OkHttp for the existing Next.js API.
- EncryptedSharedPreferences-backed session cookies, offline profile and read-only snapshots.
- Android Keystore AES-GCM encryption for queued offline mutation payloads; queued changes are bound to the account that created them.
- SQLite outbox and WorkManager network-constrained sync foundation.
- Native SpeechRecognizer and TextToSpeech for Ava; microphone permission is requested only after the user taps Activate.

## Configure the API

Set this Gradle property in local `android/gradle.properties` (do not commit private configuration):

```properties
CLASSDESK_API_BASE_URL=https://YOUR-CLASSDESK-HOST/
```

You can also set the `CLASSDESK_API_BASE_URL` environment variable. The default example host is deliberately non-production; sign-in will not work until a real HTTPS origin is configured.

## Build

Requirements: Android Studio with Android SDK 35 and JDK 17.

Open the `android/` folder in Android Studio, allow Gradle sync, install the SDK components, and run on an emulator or physical Android device. From a machine with Gradle installed, run `gradle assembleDebug` inside this folder.

## Implemented first slice

- Native sign-in against `POST /api/auth/login`.
- Session restoration against `GET /api/auth/me`.
- Encrypted persistence of the server session cookie and last authenticated profile.
- Native command-centre overview with live summary and upcoming assignments.
- Native course register with list, add and primary-admin delete.
- Native assignments with list, add, mark done/reopen and primary-admin delete.
- Native lecture register, attendance summaries and class concerns with create/list/delete flows.
- Native announcement studio with draft creation and Class Representative-only approve/publish actions.
- Native calendar/timetable entries with create, list and primary-admin delete.
- Native document library with Android system file picker, server-side upload/indexing and primary-admin permanent deletion.
- Encrypted local snapshots for the overview, courses, assignments, lectures, attendance, concerns, announcements and calendar; cached data is read-only while offline.
- SQLite mutation outbox, AES-GCM payload encryption using Android Keystore, account-bound queue ownership, a queue review screen, and WorkManager sync against the existing versioned `/api/sync` endpoint. Calendar/timetable mutations and academic/announcement create, update, approval, publication and delete requests now enqueue on network exceptions and schedule an immediate network-constrained sync attempt. Server-side validation and permission errors are returned instead of being queued.
- Ava graphical voice panel using Android speech recognition, ClassDesk AI chat and device text-to-speech. It does not request microphone access until Activate is tapped.
- Custom ClassDesk launcher icon and HTTPS-only network policy.

## Remaining implementation slices

1. Extend offline mutation creation to the remaining editable screens and add safe retry/recovery controls for rejected and conflicted changes.
2. Add document downloads, sharing, preview and export flows.
3. Add edit/update workflows for lectures, attendance, concerns and announcements, plus calendar filters.
4. Improve Ava lifecycle recovery, speech-service fallbacks, voice selection and accessibility.
5. Add unit/instrumentation tests, API contract tests and real-device acceptance testing.
6. Configure the production API origin, generate Gradle wrapper, sign a release build and package APK/AAB.

No deployment or production database changes are performed by this Android project. Do not treat the APK as release-ready until Gradle build, device tests, authentication, offline recovery and API integration tests pass.
