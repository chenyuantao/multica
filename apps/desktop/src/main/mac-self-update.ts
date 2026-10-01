import { app } from "electron";
import { execFile, spawn } from "child_process";
import { constants } from "fs";
import { access, mkdtemp, readdir, rm } from "fs/promises";
import { dirname, join } from "path";
import type { AppUpdater, UpdateDownloadedEvent } from "electron-updater";

// electron-updater's MacUpdater hands the downloaded zip to Squirrel.Mac,
// which refuses any bundle that is not signed with a Developer ID. For
// ad-hoc signed builds we keep electron-updater's download, sha512
// validation, and events, and only replace the final hand-off: the new
// .app is staged on disk and swapped in by a detached script after quit.

// Private MacUpdater members this module overrides. Pinned by
// mac-self-update.test.ts so an electron-updater upgrade that renames them
// fails CI instead of silently falling back to Squirrel.Mac.
interface MacUpdaterInternals {
  updateDownloaded(zipFileInfo: unknown, event: UpdateDownloadedEvent): Promise<string[]>;
  dispatchUpdateDownloaded(event: UpdateDownloadedEvent): void;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface StagedUpdate {
  stagingDir: string;
  bundle: string;
}

// Args: <pid> <target .app> <staged .app> <staging dir> <relaunch 0|1>.
// The current bundle is moved aside first and restored if the copy fails,
// so an interrupted swap never leaves the user without an app.
export const SWAP_SCRIPT = `
pid="$1"; target="$2"; source="$3"; staging="$4"; relaunch="$5"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
backup="$target.previous"
if [ -d "$source/Contents" ]; then
  rm -rf "$backup"
  if mv "$target" "$backup"; then
    if ditto "$source" "$target"; then
      rm -rf "$backup"
      xattr -dr com.apple.quarantine "$target" 2>/dev/null
    else
      rm -rf "$target"
      mv "$backup" "$target"
    fi
  fi
fi
rm -rf "$staging"
if [ "$relaunch" = "1" ]; then open "$target"; fi
`;

export function appBundlePath(execPath: string): string | null {
  const marker = ".app/Contents/MacOS/";
  const index = execPath.lastIndexOf(marker);
  return index === -1 ? null : execPath.slice(0, index + ".app".length);
}

export function isDeveloperIdSigned(codesignDetails: string): boolean {
  return /^Authority=Developer ID Application: /m.test(codesignDetails);
}

function readCodesignDetails(bundle: string): Promise<string> {
  return new Promise((resolve) => {
    // codesign prints details on stderr and exits non-zero for unsigned code.
    execFile("codesign", ["-dvv", bundle], (_err, stdout, stderr) => {
      resolve(`${stdout}${stderr}`);
    });
  });
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}

async function assertReplaceable(bundle: string): Promise<void> {
  // Gatekeeper runs quarantined apps launched from Downloads out of a
  // read-only translocated copy; replacing that copy would be lost.
  if (bundle.includes("/AppTranslocation/")) {
    throw new Error(
      "Multica is running from a translocated location; move it to the Applications folder to enable updates",
    );
  }
  await access(dirname(bundle), constants.W_OK);
}

async function stageBundle(zipPath: string): Promise<StagedUpdate> {
  const stagingDir = await mkdtemp(join(app.getPath("temp"), "multica-update-"));
  try {
    await run("ditto", ["-x", "-k", zipPath, stagingDir]);
    const entry = (await readdir(stagingDir)).find((name) => name.endsWith(".app"));
    if (!entry) throw new Error("update archive does not contain an .app bundle");
    return { stagingDir, bundle: join(stagingDir, entry) };
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
}

export function installMacSelfUpdate(
  updater: AppUpdater,
  execPath: string = process.execPath,
): void {
  const internals = updater as unknown as MacUpdaterInternals;
  if (typeof internals.updateDownloaded !== "function") {
    console.warn("[updater] MacUpdater internals changed; ad-hoc self-update disabled");
    return;
  }
  const target = appBundlePath(execPath);
  if (!target) return;

  const originalUpdateDownloaded = internals.updateDownloaded.bind(updater);
  const originalQuitAndInstall = internals.quitAndInstall.bind(updater);
  const developerIdSigned = readCodesignDetails(target).then(isDeveloperIdSigned);
  let staged: StagedUpdate | null = null;
  let swapStarted = false;

  const startSwap = (relaunch: boolean): void => {
    if (!staged || swapStarted) return;
    swapStarted = true;
    spawn(
      "/bin/sh",
      [
        "-c",
        SWAP_SCRIPT,
        "sh",
        String(process.pid),
        target,
        staged.bundle,
        staged.stagingDir,
        relaunch ? "1" : "0",
      ],
      { detached: true, stdio: "ignore" },
    ).unref();
  };

  internals.updateDownloaded = async (zipFileInfo, event) => {
    if (await developerIdSigned) return originalUpdateDownloaded(zipFileInfo, event);
    await assertReplaceable(target);
    const next = await stageBundle(event.downloadedFile);
    if (staged) await rm(staged.stagingDir, { recursive: true, force: true });
    staged = next;
    internals.dispatchUpdateDownloaded(event);
    return [];
  };

  internals.quitAndInstall = (isSilent, isForceRunAfter) => {
    if (!staged) {
      originalQuitAndInstall(isSilent, isForceRunAfter);
      return;
    }
    startSwap(true);
    app.quit();
  };

  app.on("will-quit", () => {
    if (updater.autoInstallOnAppQuit) startSwap(false);
  });
}
