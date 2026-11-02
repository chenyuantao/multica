#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
repo=${GH_REPO:-chenyuantao/multica}
export GH_REPO="$repo"
code=$(date -u +%s)
tag="imind-android-$code"
channel=imind-android-latest
commit=$(git rev-parse HEAD)
export code repo commit

flutter build apk --release --build-number="$code"
mkdir -p build/release-distribution
cp build/app/outputs/flutter-apk/app-release.apk build/release-distribution/imind-release.apk
python3 - <<'PY'
import hashlib, json, os, pathlib, subprocess
apk = pathlib.Path('build/release-distribution/imind-release.apk')
digest = hashlib.sha256()
with apk.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
manifest = {
    'application_id': 'ai.multica.imind_app',
    'build_mode': 'release',
    'version_code': int(os.environ['code']),
    'apk_url': f"https://github.com/{os.environ['repo']}/releases/download/imind-android-{os.environ['code']}/imind-release.apk",
    'sha256': digest.hexdigest(),
    'size': apk.stat().st_size,
    'commit': os.environ['commit'],
    'dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'])),
}
pathlib.Path('build/release-distribution/version.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY

# Versioned assets stay immutable; only the named download channel moves.
gh release create "$tag" --target "$commit" --draft --prerelease --latest=false \
  --title "iMind Android release $code" \
  --notes "Release-mode APK, signed with the existing development key for in-place installation. See version.json for source revision and working-tree status."
gh release upload "$tag" build/release-distribution/imind-release.apk build/release-distribution/version.json
gh release edit "$tag" --draft=false --latest=false

if ! gh release view "$channel" >/dev/null 2>&1; then
  gh release create "$channel" --target "$commit" --prerelease --latest=false \
    --title 'iMind Android latest release build' \
    --notes 'Fixed download: imind-release.apk. Release-mode builds currently use the existing development signing key. version.json identifies the immutable build and checksum.'
fi
mkdir -p build/release-current
has_manifest=$(gh release view "$channel" --json assets --jq 'any(.assets[]; .name == "version.json")')
if [[ "$has_manifest" == true ]]; then
  gh release download "$channel" --pattern version.json --dir build/release-current --clobber
  python3 - <<'PY'
import json, os, pathlib
current = json.loads(pathlib.Path('build/release-current/version.json').read_text())
if current['version_code'] >= int(os.environ['code']):
    raise SystemExit('A newer release is already published; refusing to roll the download channel back.')
PY
fi
gh release upload "$channel" build/release-distribution/imind-release.apk build/release-distribution/version.json --clobber
echo "https://github.com/$repo/releases/download/$channel/imind-release.apk"
