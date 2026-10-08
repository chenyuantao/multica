// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import type { FileShare } from "@multica/core/types";
import enRuntimes from "../../locales/en/runtimes.json";
import enCommon from "../../locales/en/common.json";
import { fileShareMatchesMachine, FileShareSection } from "./file-share-section";
import type { RuntimeMachine } from "./runtime-machines";

vi.mock("@multica/core/file-shares", () => ({
  fileShareListOptions: () => ({ queryKey: ["file-shares"], queryFn: async () => [] }),
  useUpdateFileShare: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: () => ({
      data: [
        {
          machine: "mbp",
          dir: "/Users/tao/notes",
          visibility: "private",
          enabled: true,
          online: true,
          workspace_id: "ws-1",
        } satisfies FileShare,
      ],
    }),
  };
});

const machine = {
  id: "m1",
  title: "mbp",
  deviceInfo: null,
  runtimes: [],
} as unknown as RuntimeMachine;

function renderSection() {
  return render(
    <I18nProvider locale="en" resources={{ en: { common: enCommon, runtimes: enRuntimes } }}>
      <FileShareSection wsId="ws-1" machine={machine} />
    </I18nProvider>,
  );
}

describe("file share runtime section", () => {
  it("matches a share to the machine name", () => {
    const share = { machine: "mbp" } as FileShare;
    expect(fileShareMatchesMachine(share, machine)).toBe(true);
    expect(fileShareMatchesMachine(share, { ...machine, title: "other" })).toBe(false);
  });

  it("shows the path, online state, and access switch without a path editor", async () => {
    const user = userEvent.setup();
    renderSection();
    expect(screen.getByText("/Users/tao/notes")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const access = screen.getByRole("switch", { name: "Remote access" });
    expect(access).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Everyone in this workspace" }));
  });
});
