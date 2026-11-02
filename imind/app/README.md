# iMind client

Flutter iOS/Android client for the local Multica backend. See `../CONTRACT.md` for API and Markdown storage contracts.

## App branding

The display name is `iMind` on Android and iOS. The vector icon master is kept
in `assets/branding/icon.svg`; `icon.png` is its generated 2048px transparent
render. Run `swift tool/generate_app_icons.swift` from this directory on macOS
with `librsvg` installed (`brew install librsvg`) to regenerate that render and
the Android density variants,
adaptive icon foregrounds, and all iOS AppIcon sizes. iOS icons have an opaque
white background; Android adaptive icons use a white background layer and a
transparent foreground with mask-safe padding. App IDs remain unchanged for
in-place updates.

## Android release download

The fixed URL for the latest release-mode APK is:

[Download iMind for Android](https://github.com/chenyuantao/multica/releases/download/imind-android-latest/imind-release.apk)

`.github/workflows/imind-android-release.yml` verifies and publishes builds on
the same branches and app paths as the debug workflow, or through a manual
Actions run. Each build also has an immutable `imind-android-<version_code>`
prerelease with the APK and `version.json` (checksum, source revision and local
working-tree status). The `imind-android-latest` prerelease holds the moving
download and manifest without changing Multica's latest stable release.

To build and publish the current checkout locally, authenticate `gh` and run
from `imind/app/`:

```sh
bash tool/publish_android_release.sh
```

Release mode currently uses the same existing development signing key as the
debug builds. CI restores `IMIND_ANDROID_DEBUG_KEYSTORE_BASE64`; local builds
use `~/.android/debug.keystore` or `IMIND_DEBUG_KEYSTORE`. This supports
in-place installation with matching keys; it is not store distribution signing.
Release version codes use Unix seconds and exceed the debug channel's version
codes. Release builds do not check the debug update channel; install future
release builds from the fixed URL. Returning to a lower-version debug build
requires a separate migration and should not be done by uninstalling user data.

## Android debug distribution and updates

`.github/workflows/imind-android-debug.yml` builds and publishes on pushes that
change `imind/app/` on `main` or `feat/group-chat-im`, or through a manual Actions
run. It runs analysis and Flutter tests before building a normal debug APK with
no test entrypoint or embedded account session. The API base remains the app's
default public backend.

Configure the repository secret `IMIND_ANDROID_DEBUG_KEYSTORE_BASE64` with the
base64-encoded **existing** `~/.android/debug.keystore` used for the currently
installed app (standard `androiddebugkey` alias and `android` passwords). Supply
the key to `gh secret set` via stdin; never print it or commit it. CI restores it
to a private temporary file and deletes it after the job. It must remain stable
across builds: generating a new key for each runner prevents in-place updates.
For local distribution builds, `IMIND_DEBUG_KEYSTORE=/absolute/path/to/key`
selects the same key; ordinary local builds keep Flutter's usual debug key.

The version code is `1000 + github.run_number` for this workflow; do not reset
its numbering or distribute local builds with higher version codes. Each build
has its own prerelease `imind-debug-<version_code>` containing `imind-debug.apk`
and `version.json`. Published APKs are never overwritten. The separate
`imind-debug` prerelease contains the moving `version.json` channel pointer;
neither channel changes the repository's latest stable release. Reruns can
repair channel publication using the already published build manifest, and
older queued runs cannot roll the pointer backwards.

Install the first versioned APK manually. Older apps without the updater cannot
discover the first update. The distribution build embeds:

```sh
--dart-define=IMIND_UPDATE_MANIFEST_URL=https://github.com/chenyuantao/multica/releases/download/imind-debug/version.json
```

On startup and foreground resume (at most once every five minutes per process),
the app checks that channel and prompts only for a higher version. Choosing
Download fetches the APK, checks its byte size, SHA-256, package name, version
code and signing certificate, then opens Android's installer. If Android asks
for permission to install from iMind, enable it, return and choose Continue
installation. Installation requires system confirmation. Matching package and
signing key preserve existing app data. Download can be cancelled; network or
metadata failures leave the app usable. Declining a version suppresses its
prompt until the process restarts. Returning from background is checked too;
it does not require force-stopping the app.

Unconfigured local builds, integration-test builds, iOS and release mode do not
check this channel. The installer permission and APK file provider exist only
in the Android debug manifest. Public repositories need no download token. Do
not embed a GitHub token for a private repository; private distribution requires
a separate authenticated backend and is not supported by this direct-download
channel. Reachability of GitHub and its asset hosts is required on the device.

For a local bootstrap build, run from `imind/app/`:

```sh
flutter build apk --debug \
  --dart-define=IMIND_UPDATE_MANIFEST_URL=https://github.com/chenyuantao/multica/releases/download/imind-debug/version.json
```

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

## Home navigation acceptance

The home screen has Notes, Conversations, and Me tabs. Note creation, clipping,
and recording are in the top-right menu above sorting. Conversations lists
joined chats in the selected workspace; its contacts drawer contains only
agents and members. Opening a chat reuses the AI+ composer and message UI in a
full page. Me shows the current profile and sign-out action.

Run the isolated native navigation check from this directory:

```sh
flutter drive --driver=test_driver/navigation_driver.dart \
  --target=integration_test/navigation_e2e_test.dart -d <iOS-simulator-ID>
```

It uses in-memory API/session fixtures, checks menu order, tabs, contacts,
message sending, return navigation and sign-out, and captures nine screenshots
under `outputs/imind/navigation/` in the repository root. It does
not verify a live backend, WebSocket delivery, or real agent execution. Restore
a normal app build after running the integration entry point.

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

### Functional optimization acceptance

Run `tool/run_feature_e2e.py --platform ios --device <iOS-27-UDID> --suite optimization`, then `--suite progress`, followed by the same suites on Android (`--mirror` if needed). Use local services for every suite. `optimization` checks clip raw text and prompt persistence, a single file chat and retry, naming failure preservation (or real generation when configured), and manual recording rename. `progress` creates an offline runtime and queue-only agent in the dedicated local database, opens real execution history, checks independent default-collapsed thinking/tool/message/error entries and expansion retention across polling, and cancels one run while a second file's run stays queued. Its random fixture agent/runtime/tasks are removed on exit; no agent CLI runs.

DeepSeek is configured in Workspace → General → iMind. The deployment requires `MULTICA_IMIND_SECRET_KEY` (32 random bytes encoded as base64) to encrypt workspace API keys. For local Docker, export it before the compose command; keep it in private local storage, outside the repository. The model API key is entered only in the admin setting, never in Flutter defines. Without a configured model key, the recording is saved, naming shows a retry action, and “保留原标题” exits safely. AI naming is also available from the selected file actions. Automatic recording naming runs only after note and media persistence succeeds.

### Detail toolbar and chat keyboard acceptance

```sh
python3 tool/run_feature_e2e.py --platform ios --device <booted-iOS-UDID> --suite detail
```

The `detail` suite creates temporary notes, clips and recordings through the local API, opens their actual Flutter detail screens, and verifies the shared menu, metadata sheet, one-line toolbar title, inline editing and persistence, toolbar AI+ entry, and native keyboard behavior. It starts/stops the native microphone and real ASR while the keyboard is open, then checks dismissal from the chat header, message area and Send. Fixture files are deleted on exit; their dedicated file chats may remain in the acceptance workspace. Screenshots and logs use the `ios-detail-p1` prefix in `outputs/imind/`. Restore a normal build after running the suite.

### iOS interaction, tags, and editor voice acceptance

Run `python3 tool/run_feature_e2e.py --platform ios --device <booted-iOS-27-UDID> --suite interaction` against the dedicated local acceptance environment. This suite covers home placement, pull refresh (including empty filtered results), OR tag chips, reading/editing exit gestures on notes/clips/recordings, manual and real DeepSeek tagging, revision conflicts, authorized native image preview, and editor dictation. It requires the existing local DeepSeek and ASR configuration. Native microphone capture is checked separately from paced synthetic PCM sent through real ASR; the latter verifies selection replacement and preservation of text after the cursor.

The image case prints `E2E_INTERACTION_NATIVE_VIEWER` and pauses for native inspection. During that pause, inspect Quick Look and close it with Done using the iOS UI tools; the Flutter test resumes and checks the detail menu. The dictation error case restarts only the local acceptance backend to verify an actual WebSocket disconnect and retry. Results, sanitized logs, and screenshots use `ios-interaction-p1` under `outputs/imind/`. Restore a normal local build afterward to remove the integration entry point and temporary defines. See [INTERACTION_VALIDATION.md](../INTERACTION_VALIDATION.md) for results and coverage boundaries.

## Cached reading and conversation search

Notes and conversations race encrypted local reads against network reads for
both lists and details. A cached result can render first; a successful network
result replaces it and updates the cache. Late cache results never replace
network data. Cache namespaces include the API origin, account session,
workspace and shared root. Network confirmation is required before writing,
sending, renaming, tagging, deleting or starting a contact conversation; a
shared interceptor shows a toast while keeping the local draft. Failed note
reads retain the cached content and offer a sync retry.

The Conversations header opens search inline. Search combines cached message
history with the existing `/api/group-chats/search` endpoint; ranking follows
Multica IM's title match, match count and latest activity order. Local search
covers downloaded history; network search covers accessible server history.
Contacts use the same actor avatar renderer as conversation rows and reuse the
existing direct conversation or the idempotent direct-chat endpoint.

Native fixture acceptance covers navigation, contact creation, message search,
cache-first rendering and mutation blocking. To keep platform screenshots apart:

```sh
IMIND_NAVIGATION_OUTPUT=../../outputs/imind/navigation-android \
  flutter drive --driver=test_driver/navigation_driver.dart \
  --target=integration_test/navigation_e2e_test.dart -d <Android-emulator-ID>
```

For real local API, message persistence, content search, encrypted cache reopen
and delayed-history interception, run:

```sh
python3 tool/run_feature_e2e.py --platform ios --device <iOS-simulator-ID> --suite navigation
python3 tool/run_feature_e2e.py --platform android --device <Android-emulator-ID> --suite navigation --mirror
```

The live suite requires the dedicated `imind-validation` workspace, an active
`imindhost` share, no executable agents, and the existing `iMind device peer`
fixture. It removes its unique test message afterward. It keeps the dedicated
peer conversation for reuse. Restore a normal build after native acceptance.
