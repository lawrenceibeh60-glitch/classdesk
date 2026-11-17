# AFIT ClassDesk Android

Native Android client workspace for the existing ClassDesk service.

## Architecture

- Kotlin + Jetpack Compose native screens and navigation shell.
- Retrofit + OkHttp for the existing Next.js API.
- EncryptedSharedPreferences-backed session cookies, offline profile and read-only snapshots.
- Android Keystore AES-GCM encryption for queued offline mutation payloads; queued changes are bound to the account that created them.
- SQLite outbox and WorkManager network-constrained sync foundation.
- Native Jetpack Compose text chat for Ava, connected to the same authenticated ClassDesk AI endpoint as the website with voice mode disabled. The chat preserves confirmation-protected actions; the Tools shortcut opens the existing native document and administration utilities.

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
- Class Representative Android sessions can be unlocked with the phone's strong biometric or device screen lock after the first authorised password sign-in. This gate is Android-only; website authentication is unchanged. Password sign-in remains available as a fallback.
- Command-centre overview, course register, assignments, lectures, attendance, concerns, announcements and calendar/timetable records.
- Catch-up Centre, Coverage, Class Records and account/system diagnostics.
- Native document library with system file selection, upload/indexing, download/save and primary-account deletion controls.
- JSON and ZIP backup export, plus confirmation-protected restore using the shared server endpoints.
- Ava text chat using the shared xKiro-backed AI endpoint, with the native Tools screen available directly from the chat.
- Encrypted local snapshots for the overview and academic modules; cached content is read-only while offline.
- SQLite offline mutation queue with Android Keystore encryption, account-bound ownership, manual sync, cloud-vs-local conflict resolution with version rebasing, rejected/corrupt item discard controls, and WorkManager retry/synchronisation for supported academic, announcement and calendar mutations.
- Local notifications for newly observed announcements, assignments, timetable records, attendance and concern updates. Notification polling is periodic WorkManager work, not real-time push delivery.
- Custom ClassDesk launcher icon and HTTPS-only network policy.

## Release-readiness work still required

1. Run the full ClassDesk CI suite: web source verification, Prisma validation, TypeScript, lint, production build, Android Kotlin compilation and unit tests.
2. The CI pipeline builds and uploads a debug APK only after both the web validation and Android verification jobs pass on the fix branch.
3. Complete physical-device acceptance testing for sign-in, both staff roles, Ava text chat and tool access, biometric/device-credential unlock, notifications, file upload/download, backup/restore, offline queue replay, account switching and logout. CI success does not replace this device testing.
4. Confirm the production API origin and configure release signing credentials securely outside the repository.

No production deployment or merge to `main` is included in this change. The CI APK is a debug test artifact, not a signed production release.
