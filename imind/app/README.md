# iMind client

Flutter iOS/Android client for the local Multica backend. See `../CONTRACT.md` for API and Markdown storage contracts.

## Android E2E

Start the local backend and file-share daemon described in `../HANDOFF.md`. Boot a dedicated Android emulator and confirm `adb devices` reports it as `device`. The validation AVD uses Android 15 with 4 GB RAM; the older 2 GB AVD became unresponsive during repeated package installation. Preserve existing emulator data when investigating this.

Use a JDK supported by the Android build and set `JAVA_HOME` explicitly if the host has a stale system value. Run from this directory:

```sh
python3 tool/run_android_e2e.py --device emulator-5554 --suite all
```

The runner reads the dedicated local profile `imind-android`, uses the emulator's `10.0.2.2` route to the backend, and skips verification-code login by restoring that session. Override the profile or share machine with `--profile` and `--machine`. Credentials are placed in a private temporary Dart defines file and removed after the run. Never commit defines files or test APKs; test APKs contain the supplied session. The runner keeps the app installed after tests so its secure session can be checked across process restarts. Restore a normal build after testing.

The default audio fixture uses macOS `say` and `afconvert`. On other hosts, provide `--pcm /absolute/path/to/speech.pcm` containing 16 kHz mono signed 16-bit little-endian PCM. Real ASR requires private backend credentials; they must never be passed to the client. Synthetic audio replaces the recorder source in the duration test; native microphone acquisition is covered separately by the main suite.

Use `--suite main`, `--suite features`, or `--suite duration` for targeted verification. The duration test sends audio in real time for over three minutes and includes a pause, resume, and accompanying note. It does not establish hour-long recording reliability or word-perfect recognition.

If Maven Central is unreachable, `--mirror` sets `IMIND_MAVEN_MIRROR=aliyun` for the child build. The Android project applies mirror repositories after project evaluation, outside Flutter's included Gradle build. The same variable can be used for normal APK builds. No global Gradle files are changed.

The application and library Android plugins are aligned with the Flutter SDK integration-test plugin. Kotlin is explicitly applied because built-in Kotlin is disabled. Keep these plugin choices consistent when upgrading Flutter; verify both a normal APK and an integration-test APK.

```sh
flutter analyze
flutter test --concurrency=1
IMIND_MAVEN_MIRROR=aliyun flutter build apk --debug
adb -s emulator-5554 install -r build/app/outputs/flutter-apk/app-debug.apk
adb -s emulator-5554 shell am start -n ai.multica.imind_app/.MainActivity
```

Export, recycle-bin recovery, recording playback, and real AI+ generation are unavailable in the current product. E2E checks their disabled or Mock state and does not claim those capabilities are implemented.
