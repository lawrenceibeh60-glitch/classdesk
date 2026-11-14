# AFIT ClassDesk Android

Native Android client workspace for the existing ClassDesk service.

## Architecture
- Kotlin + Jetpack Compose native screens.
- Retrofit + OkHttp for the existing Next.js API.
- EncryptedSharedPreferences-backed storage for the server session cookie.
- Room and WorkManager are planned for offline drafts and deferred sync.
- Microphone permission is declared for Ava; it is not requested at startup.

## Configure the API
Set this Gradle property in local \`android/gradle.properties\` (do not commit private configuration):

\`\`\`properties
CLASSDESK_API_BASE_URL=https://YOUR-CLASSDESK-HOST/
\`\`\`

You can also set the \`CLASSDESK_API_BASE_URL\` environment variable. The default example host is deliberately non-production; sign-in will not work until a real HTTPS origin is configured.

## Build
Requirements: Android Studio with Android SDK 35 and JDK 17.

Open the \`android/\` folder in Android Studio, allow Gradle sync, install the SDK components, and run on an emulator or physical Android device. From a machine with Gradle installed, run \`gradle assembleDebug\` inside this folder.

## First working slice
- Native Compose app shell and dark ClassDesk visual language.
- Login via \`POST /api/auth/login\`.
- Session restoration via \`GET /api/auth/me\`.
- Encrypted persistence of the server session cookie.
- Live overview via \`GET /api/academic?resource=summary\`.
- Sign-out clears locally stored session cookies.

## Remaining native modules
1. Courses, lectures, assignments, attendance and concerns.
2. Room offline cache and mutation outbox with conflict handling.
3. Document picker, upload, downloads, sharing and exports.
4. Ava graphical voice interface and explicit microphone permission.
5. Push notifications, sync scheduling and lifecycle resilience.
6. Accessibility, instrumentation tests, release signing and APK/AAB packaging.

No deployment or production database changes are performed by this Android project.
