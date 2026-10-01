// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppUpdater, UpdateDownloadedEvent } from "electron-updater";

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;

const ctx = vi.hoisted(() => ({
  codesignDetails: "",
  tempPath: "",
  quit: vi.fn(),
  quitHandlers: [] as Array<() => void>,
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => ctx.tempPath),
    quit: ctx.quit,
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "will-quit") ctx.quitHandlers.push(handler);
    }),
  },
}));

vi.mock("child_process", () => ({
  execFile: vi.fn((cmd: string, args: string[], callback: ExecFileCallback) => {
    if (cmd === "codesign") {
      callback(null, "", ctx.codesignDetails);
      return;
    }
    if (cmd === "ditto") {
      // Simulate extracting the release zip: `ditto -x -k <zip> <dir>`.
      mkdirSync(join(args[3], "Multica.app", "Contents"), { recursive: true });
    }
    callback(null, "", "");
  }),
  spawn: ctx.spawn,
}));

import { MacUpdater } from "electron-updater";
import {
  appBundlePath,
  installMacSelfUpdate,
  isDeveloperIdSigned,
  SWAP_SCRIPT,
} from "./mac-self-update";

const AD_HOC_DETAILS = [
  "Executable=/Applications/Multica.app/Contents/MacOS/Multica",
  "Identifier=ai.multica.desktop",
  "Signature=adhoc",
  "TeamIdentifier=not set",
].join("\n");

const DEVELOPER_ID_DETAILS = [
  "Executable=/Applications/Multica.app/Contents/MacOS/Multica",
  "Authority=Developer ID Application: Example Inc (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=ABCDE12345",
].join("\n");

function fakeUpdater() {
  return {
    autoInstallOnAppQuit: true,
    updateDownloaded: vi.fn<(zipFileInfo: unknown, event: UpdateDownloadedEvent) => Promise<string[]>>(
      async () => ["squirrel"],
    ),
    dispatchUpdateDownloaded: vi.fn(),
    quitAndInstall: vi.fn(),
  };
}

const event = { version: "0.6.0", downloadedFile: "/tmp/update.zip" } as UpdateDownloadedEvent;

describe("MacUpdater internals", () => {
  it("still exposes the members the ad-hoc self-update overrides", () => {
    const proto = MacUpdater.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.updateDownloaded).toBe("function");
    expect(typeof proto.dispatchUpdateDownloaded).toBe("function");
    expect(typeof proto.quitAndInstall).toBe("function");
  });
});

describe("appBundlePath", () => {
  it("resolves the .app bundle containing the executable", () => {
    expect(appBundlePath("/Applications/Multica.app/Contents/MacOS/Multica")).toBe(
      "/Applications/Multica.app",
    );
  });

  it("returns null outside an app bundle", () => {
    expect(appBundlePath("/usr/local/bin/electron")).toBeNull();
  });
});

describe("isDeveloperIdSigned", () => {
  it("distinguishes Developer ID from ad-hoc signatures", () => {
    expect(isDeveloperIdSigned(DEVELOPER_ID_DETAILS)).toBe(true);
    expect(isDeveloperIdSigned(AD_HOC_DETAILS)).toBe(false);
    expect(isDeveloperIdSigned("code object is not signed at all")).toBe(false);
  });
});

describe.runIf(process.platform === "darwin")("SWAP_SCRIPT", () => {
  let root: string;
  let target: string;
  let stagingDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mac-swap-"));
    target = join(root, "Multica.app");
    mkdirSync(join(target, "Contents"), { recursive: true });
    writeFileSync(join(target, "Contents", "version"), "old");
    stagingDir = join(root, "staging");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function runSwap(source: string): Promise<void> {
    const { execFileSync } =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    // pid 999999 does not exist, so the script skips waiting for the app to exit.
    execFileSync("/bin/sh", ["-c", SWAP_SCRIPT, "sh", "999999", target, source, stagingDir, "0"]);
  }

  it("replaces the bundle and removes the staging dir", async () => {
    const source = join(stagingDir, "Multica.app");
    mkdirSync(join(source, "Contents"), { recursive: true });
    writeFileSync(join(source, "Contents", "version"), "new");

    await runSwap(source);

    expect(readFileSync(join(target, "Contents", "version"), "utf8")).toBe("new");
    expect(existsSync(`${target}.previous`)).toBe(false);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("leaves the current bundle untouched when the staged bundle is gone", async () => {
    await runSwap(join(stagingDir, "Multica.app"));

    expect(readFileSync(join(target, "Contents", "version"), "utf8")).toBe("old");
  });
});

describe("installMacSelfUpdate", () => {
  let root: string;
  let execPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mac-self-update-"));
    ctx.tempPath = join(root, "tmp");
    mkdirSync(ctx.tempPath);
    execPath = join(root, "Applications", "Multica.app", "Contents", "MacOS", "Multica");
    mkdirSync(join(root, "Applications"));
    ctx.quitHandlers = [];
    ctx.quit.mockClear();
    ctx.spawn.mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps the Squirrel.Mac path for Developer ID builds", async () => {
    ctx.codesignDetails = DEVELOPER_ID_DETAILS;
    const updater = fakeUpdater();
    const original = updater.updateDownloaded;
    installMacSelfUpdate(updater as unknown as AppUpdater, execPath);

    await expect(updater.updateDownloaded({}, event)).resolves.toEqual(["squirrel"]);
    expect(original).toHaveBeenCalledOnce();
    expect(updater.dispatchUpdateDownloaded).not.toHaveBeenCalled();
  });

  it("stages the bundle and swaps it in after quit for ad-hoc builds", async () => {
    ctx.codesignDetails = AD_HOC_DETAILS;
    const updater = fakeUpdater();
    const original = updater.updateDownloaded;
    const originalQuitAndInstall = updater.quitAndInstall;
    installMacSelfUpdate(updater as unknown as AppUpdater, execPath);

    await updater.updateDownloaded({}, event);
    expect(original).not.toHaveBeenCalled();
    expect(updater.dispatchUpdateDownloaded).toHaveBeenCalledWith(event);

    updater.quitAndInstall();
    expect(originalQuitAndInstall).not.toHaveBeenCalled();
    expect(ctx.quit).toHaveBeenCalledOnce();
    expect(ctx.spawn).toHaveBeenCalledOnce();
    const args = (ctx.spawn.mock.calls[0] as unknown as [string, string[]])[1];
    const [, , , , target, source, stagingDir, relaunch] = args;
    expect(target).toBe(join(root, "Applications", "Multica.app"));
    expect(existsSync(join(source, "Contents"))).toBe(true);
    expect(source.startsWith(stagingDir)).toBe(true);
    expect(relaunch).toBe("1");

    // The will-quit hook that follows app.quit() must not start a second swap.
    for (const handler of ctx.quitHandlers) handler();
    expect(ctx.spawn).toHaveBeenCalledOnce();
  });

  it("installs a staged update on a normal quit without relaunching", async () => {
    ctx.codesignDetails = AD_HOC_DETAILS;
    const updater = fakeUpdater();
    installMacSelfUpdate(updater as unknown as AppUpdater, execPath);

    await updater.updateDownloaded({}, event);
    for (const handler of ctx.quitHandlers) handler();

    expect(ctx.spawn).toHaveBeenCalledOnce();
    const args = (ctx.spawn.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args.at(-1)).toBe("0");
  });

  it("refuses to stage an update when running translocated", async () => {
    ctx.codesignDetails = AD_HOC_DETAILS;
    const updater = fakeUpdater();
    installMacSelfUpdate(
      updater as unknown as AppUpdater,
      "/private/var/folders/x/AppTranslocation/ABC/d/Multica.app/Contents/MacOS/Multica",
    );

    await expect(updater.updateDownloaded({}, event)).rejects.toThrow(/translocated/);
    expect(updater.dispatchUpdateDownloaded).not.toHaveBeenCalled();
  });
});
