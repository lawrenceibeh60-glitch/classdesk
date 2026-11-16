# AFIT ClassDesk APK

This directory is the staging location for Android APK build outputs.

## Build configuration

- Android source: `../android/`
- Build task: `gradle assembleDebug`
- JDK: 17
- Gradle: 8.11.1
- Android SDK: 35
- Default API origin: `https://afit-classdesk.vercel.app/`

## Output

The Android APK workflow stages the generated debug package here as:

`AFIT-ClassDesk-debug.apk`

The workflow uploads that file as the GitHub Actions artifact **AFIT-ClassDesk-debug-apk** (7-day retention). Generated binaries are intentionally not committed to Git; this keeps the repository source-only and avoids accidentally distributing stale or unsigned packages.

## Build locally

From the repository root, with JDK 17, Android SDK 35 and Gradle 8.11.1 installed:

```bash
cd android
gradle assembleDebug
mkdir -p ../apk
cp app/build/outputs/apk/debug/app-debug.apk ../apk/AFIT-ClassDesk-debug.apk
```

For a production release, first complete physical-device acceptance testing and configure a private release keystore through protected CI secrets. Never commit keystores or signing passwords.
