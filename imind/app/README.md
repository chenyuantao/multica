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

Export and recycle-bin recovery remain unavailable. AI naming remains Mock. AI+ uses persisted file-specific Multica group chats; images and original WAV recordings use the authenticated shared-media contract in `../CONTRACT.md`.

## Production verification

Remote profiles require explicit `--production` and HTTPS. Use a dedicated private share whose served prefix starts with `imind-prod-e2e-`, an authorized account session, and uniquely named test fixtures. Never repoint an existing user directory for testing. The runner uses the remote API directly rather than the emulator's host loopback address.

```sh
python3 tool/run_android_e2e.py --device emulator-5554 \
  --profile production-e2e --machine imind-prod-e2e-example \
  --production --suite features --mirror
```

Production ASR must be configured on the backend before running the main or duration suites. HTTP 503 `imind_asr_unconfigured` is an environment blocker; successful note tests do not establish real ASR or long-recording verification. Credentials remain in private profile/temporary files and never belong in repository sources or logs.

## Local Docker email-code login E2E

This independent suite starts with empty secure storage and sends and verifies actual codes through the App. Its local, authenticated test bridge reads only the dedicated account's newest unused, unexpired code created after the current request boundary, using `docker compose exec postgres`. The database comes from this checkout's selected environment file and is checked against the running iMind backend. Codes remain in memory and are redacted from captured test output. No preset token or development-code override is supplied to the App.

The profile must reference the dedicated `imind-validation` workspace and its workspace-visible acceptance share. The runner provisions `imind-login-e2e@example.com` as a member of that workspace. It honors the backend resend cooldown. Android forwards the private bridge through `adb reverse`; no externally listening bridge is opened.

```sh
python3 tool/run_android_e2e.py --device emulator-5554 --suite login --mirror
python3 tool/run_login_e2e.py --platform ios --device <booted-iOS-27-UDID>
```

The test covers incorrect-code feedback, authenticated note creation/read, logout, a second real code login, and secure storage restoration. Run the same command with `--restore-only` through `run_login_e2e.py` to check a separate test process restores the stored session. Ordinary application process restart is a separate device verification. Reports and sanitized logs are saved in `outputs/imind/` at the repository root. A test failure is retained as failed evidence until a later run passes.

## Focused P1 device acceptance

```sh
python3 tool/run_feature_e2e.py --platform ios --device <iOS-27-UDID> --suite media
python3 tool/run_feature_e2e.py --platform ios --device <iOS-27-UDID> --suite media --restore-media
python3 tool/run_feature_e2e.py --platform android --device emulator-5554 --suite media --mirror
python3 tool/run_feature_e2e.py --platform android --device emulator-5554 --suite media --restore-media --mirror
```

`media` uses a picker fixture and actual HTTP/daemon persistence, shared-image rendering, undo/redo, and native WAV playback. `--restore-media` requires its previous successful report, opens that shared WAV in a separate App process, and checks that its PID differs. These tests establish neither hardware camera acquisition nor audible recording quality.

`--suite chat` verifies real comments, WebSocket creation/update/deletion, file isolation, and reopened history. It deliberately restarts only the local Docker backend to verify reconnect, so run it separately from microphone/ASR acceptance. `--suite main` runs the native microphone, pause/resume, saved original WAV and playback flow. Both chat suites refuse a workspace with executable agents; default/JEV execution regression uses controlled executor results in Go tests. No installed real agent CLI is invoked.

Reports/logs are in `outputs/imind/`. Start the backend and its upgraded file-share daemon first. The runner waits for the dedicated acceptance share. After all suites, rebuild and install a normal App to remove the test entrypoint and session defines from installed test binaries.

本轮 P1 实现与逐项验收证据、既有检查失败和用户允许的真机补验边界见 [P1_VALIDATION.md](../P1_VALIDATION.md)。

### Web ↔ Flutter UI acceptance

Run `tool/run_feature_e2e.py --platform ios|android --device <device> --suite web` (add `--mirror` for Android when needed). This interactive suite creates a fresh saved note, joins two dedicated test users to its file chat, and prints `E2E_INTEROP_CHAT:<issue UUID>` / `E2E_INTEROP_READY`. It requires the agent-free local acceptance workspace and uses real HTTP and WebSocket connections.

In the local Web app, open the new `iMind · Web Flutter UI acceptance …` chat as the profile's test owner. Type `Web composer to Flutter P1` into the Web composer and click Send. The device asserts receipt and sends `Flutter composer to Web P1` through the Flutter composer. After seeing that reply in Web without reloading, send `Web confirms Flutter reply P1`; the device asserts receipt and finishes. Keep Web and native screenshots plus the platform's `*-web-p1.log` / `*-web-p1-results.json`. Fixture preparation may use APIs; the three acceptance messages must go through the actual composers. Run the two platforms serially with the same browser task space.

### AI+ streaming voice input

The composer microphone reuses `record` and `AsrSession`. Partial results replace the current sentence directly in the input, keeping the existing draft outside its initial selection. Stop drains final results before unlocking editing/sending. It never sends automatically; permission and network errors retain the draft. Closing the sheet releases recording and ASR resources.

Run `python3 tool/run_feature_e2e.py --platform ios|android --device <device> --suite voice` (`--mirror` on Android when needed). The suite checks native microphone start/stop, then paced synthetic Chinese PCM through the real backend/model, asserts text appears before stop, drains the final, and sends from the composer. This separates native capture verification from repeatable recognition content; it does not claim human speech quality. Evidence is recorded in [VOICE_VALIDATION.md](../VOICE_VALIDATION.md).
