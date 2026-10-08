// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import type { FileShare } from "@multica/core/types";
import enRuntimes from "../../locales/en/runtimes.json";
import enCommon from "../../locales/en/common.json";
import { fileShareForMachine, FileShareSection } from "./file-share-section";
import type { RuntimeMachine } from "./runtime-machines";

const mutate = vi.fn();

vi.mock("@multica/core/file-shares", () => ({
  fileShareListOptions: () => ({ queryKey: ["file-shares"], queryFn: async () => [] }),
  useUpdateFileShare: () => ({ mutate, isPending: false }),
}));

const shares: FileShare[] = [
  {
    daemon_id: "daemon-laptop",
    machine: "laptop",
    dir: "/Users/tao/notes",
    visibility: "private",
    enabled: true,
    online: true,
    workspace_id: "ws-1",
  },
  {
    daemon_id: "daemon-desktop",
    machine: "desktop",
    dir: "/home/tao/docs",
    visibility: "workspace",
    enabled: false,
    online: false,
    workspace_id: "ws-1",
  },
];

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return { ...actual, useQuery: () => ({ data: shares }) };
});

function machine(daemonId: string | null, title = "mbp"): RuntimeMachine {
  return { id: `local:${daemonId}`, daemonId, title, deviceInfo: null, runtimes: [] } as unknown as RuntimeMachine;
}

function renderSection(target: RuntimeMachine, canSetUp = false) {
  return render(
    <I18nProvider locale="en" resources={{ en: { common: enCommon, runtimes: enRuntimes } }}>
      <FileShareSection wsId="ws-1" machine={target} canSetUp={canSetUp} />
    </I18nProvider>,
  );
}

describe("file share runtime section", () => {
  it("matches each machine to its own share by daemon id, not by name", () => {
    expect(fileShareForMachine(shares, machine("daemon-laptop"))?.dir).toBe("/Users/tao/notes");
    expect(fileShareForMachine(shares, machine("daemon-desktop"))?.dir).toBe("/home/tao/docs");
    expect(fileShareForMachine(shares, machine("daemon-other", "laptop"))).toBeNull();
    expect(fileShareForMachine(shares, machine(null))).toBeNull();
  });

  it("shows only this machine's share and switches it by daemon id", async () => {
    const user = userEvent.setup();
    renderSection(machine("daemon-laptop"));
    expect(screen.getByText("laptop/")).toBeInTheDocument();
    expect(screen.getByText("/Users/tao/notes")).toBeInTheDocument();
    expect(screen.queryByText("/home/tao/docs")).not.toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Remote access" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Everyone in this workspace" }));
    expect(mutate).toHaveBeenCalledWith(
      { daemonId: "daemon-laptop", patch: { visibility: "workspace" } },
      expect.anything(),
    );
  });

  it("offers the share command on an unshared machine the viewer runs", () => {
    renderSection(machine("daemon-new"), true);
    expect(screen.getByText("Not shared")).toBeInTheDocument();
    expect(screen.getByText("multica-file share <dir>")).toBeInTheDocument();
  });

  it("renders nothing for an unshared machine the viewer does not run", () => {
    const { container } = renderSection(machine("daemon-new"), false);
    expect(container).toBeEmptyDOMElement();
  });
});
