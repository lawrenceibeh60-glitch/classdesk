# AFIT ClassDesk Android

Native Android client workspace for the existing ClassDesk service.

## Architecture

- Kotlin + Jetpack Compose native screens and navigation shell.
- Retrofit + OkHttp for the existing Next.js API.
- EncryptedSharedPreferences-backed session cookies, offline profile and read-only snapshots.
- Android Keystore AES-GCM encryption for queued offline mutation payloads; queued changes are bound to the account that created them.
- SQLite outbox and WorkManager network-constrained sync foundation.
- Native SpeechRecognizer and TextToSpeech for Ava; on-device speech recognition is preferred when Android and an installed language pack support it, with the platform recognition service as a fallback. Microphone permission is requested only after the user taps Activate.

## Configure the API

Set this Gradle property in local `android/gradle.properties` (do not commit private configuration):

```properties
CLASSDESK_API_BASE_URL=https://YOUR-CLASSDESK-HOST/
```

You can also set the `CLASSDESK_API_BASE_URL` environment variable. The current Gradle default is `https://afit-classdesk.vercel.app/`; verify that this is the intended live API origin before producing a release build. Override it locally when testing another HTTPS deployment.

## Build

Requirements: Android Studio with Android SDK 35 and JDK 17.

Open the `android/` folder in Android Studio, allow Gradle sync, install the SDK components, and run on an emulator or physical Android device. From a machine with Gradle installed, run `gradle assembleDebug` inside this folder.

## Implemented Android capabilities

- Native sign-in and session restoration against the shared ClassDesk API.
- Encrypted persistence for the session cookie and signed-in profile.
- Command-centre overview, course register, assignments, lectures, attendance, concerns, announcements and calendar/timetable records.
- Catch-up Centre, Coverage, Class Records and account/system diagnostics.
- Native document library with system file selection, upload/indexing, download/save and primary-account deletion controls.
- JSON and ZIP backup export, plus confirmation-protected restore using the shared server endpoints.
- Ava voice interface with speech recognition, AI chat, spoken responses, task/tool screens and explicit microphone permission.
- Ava is push-to-talk: each voice request requires a fresh tap. It does not automatically reopen the microphone after responding or after leaving the voice screen.
- Encrypted local snapshots for the overview and academic modules; cached content is read-only while offline.
- SQLite offline mutation queue with Android Keystore encryption, account-bound ownership, review of pending/conflicted/rejected entries, and WorkManager retry/synchronisation for supported academic, announcement and calendar mutations.
- Local notifications for newly observed announcements, assignments, timetable records, attendance and concern updates. Notification polling is periodic WorkManager work, not real-time push delivery.
- Custom ClassDesk launcher icon and HTTPS-only network policy.

## Release-readiness work still required

1. **CI verification passed on the current branch** at commit `b1b7cfdc71f84b8c20009ed7c5d52a80362dc0de`: Android Kotlin compilation and unit tests passed; web source verification, Prisma checks, TypeScript, lint and production build passed.
2. Complete physical-device acceptance testing for sign-in, both staff roles, Ava microphone permission and one-tap-per-request behavior, notifications, file upload/download, backup/restore, offline queue replay, account switching and logout. CI success does not replace this device testing.
3. Review and complete offline mutation coverage for any remaining editable screens; rejected/conflicted queue entries currently require review rather than automatic conflict resolution.
4. Confirm the production API origin and configure release signing credentials securely outside the repository.
5. Build and inspect a signed release APK/AAB only after the owner authorizes the release build.

The Android verification workflow compiles the app and runs available unit tests; it does not package or publish an APK. The separate APK workflow is manual-only. No production deployment, merge to `main`, production database mutation or APK release is authorized by this development branch.
