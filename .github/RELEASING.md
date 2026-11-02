# Release runbook

## iMind Android debug builds

The independent `iMind Android Debug` workflow publishes versioned APK
prereleases and an `imind-debug` manifest channel. It does not publish a stable
release or modify the desktop/backend release workflow. Signing setup, initial
installation, version numbering and update behavior are documented in
[`imind/app/README.md`](../imind/app/README.md#android-debug-distribution-and-updates).

## Normal release

Release from a reviewed commit on `main` by creating and pushing a new semantic
version tag such as `v0.18.4`. The Release workflow intentionally has no manual
trigger: a tag push, or a push to an automatic release branch (see
[Automatic branch releases](#automatic-branch-releases)), is the only event
that publishes binaries, Homebrew formulae, the Helm chart, and the `latest` /
version container tags. Moving branch image tags are published separately;
see [Branch images](#branch-images).

The verification job runs the Go tests and `govulncheck` before any publishing
job starts. The vulnerability scan is fail-closed by default.

## Automatic branch releases

Pushes to the branches listed under `on.push.branches` in
`.github/workflows/release.yml` release without a manual tag. After the
verification job passes, it tags the pushed commit with the next patch version
(highest `vX.Y.Z` tag plus one; with no tags, the version in
`apps/desktop/package.json` plus one) and publishes from that tag. Re-running a
workflow for an already-tagged commit reuses its tag. A failed verification
creates no tag.

## Branch images

`.github/workflows/branch-images.yml` runs on pushes to the deployed
`feat/group-chat-im` branch or when triggered manually from the Actions tab
for a selected branch. It builds multi-arch `multica-backend` and `multica-web`
images and pushes them to GHCR tagged with the branch name.
Characters Docker rejects, including `/`, become `-`, so `feat/foo` is
published as `feat-foo`.

These tags move on the next run for that branch. The workflow refuses `latest`
and semver tags such as `v1.2.3`, so a branch cannot overwrite a release. It
does not publish binaries, Homebrew formulae, or the Helm chart.

The Alibaba Cloud ECS deployment checks the latest successful branch-images
run every five minutes. It pulls both matching images, verifies their revision
labels, and recreates only the backend and frontend containers. The server's
Compose file, `.env`, PostgreSQL volume, and upload volumes stay on the ECS
host. A failed or incomplete image build is not deployed.

## Emergency vulnerability-scan bypass

Use the bypass only when `govulncheck` itself or its live vulnerability database
is unavailable, or when maintainers have documented a confirmed false positive
that blocks an urgent release. Never use it to publish a release with an
unresolved reachable vulnerability.

1. Record the reason and maintainer approval in the release issue or pull
   request, and confirm no other release is in progress.
2. In **Settings → Secrets and variables → Actions → Variables**, set the
   repository variable `ALLOW_VULN_BYPASS_FOR_TAG` to the exact release tag,
   for example `v0.18.4`.
3. Re-run the failed Release workflow for that tag. A different tag, an empty
   value, or any typo keeps the scan enabled.
4. Confirm the verification log contains the explicit bypass warning and retain
   the workflow URL in the incident record.
5. Delete `ALLOW_VULN_BYPASS_FOR_TAG` immediately after the release run
   completes. The tag-scoped value prevents a concurrent release with another
   tag from inheriting the bypass.

Every Go binary retains its compiler version in the standard Go build metadata;
use `go version -m <binary>` when auditing a downloaded release artifact.
