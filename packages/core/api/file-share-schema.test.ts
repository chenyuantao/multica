// @vitest-environment node
import { describe, it, expect } from "vitest";
import { FileShareListSchema, FileShareSchema } from "./schemas";
import { parseWithFallback } from "./schema";

describe("file share response compatibility", () => {
  it("defaults missing fields so a share without daemon_id matches no machine", () => {
    expect(FileShareSchema.parse({ machine: "mbp" })).toEqual({
      daemon_id: "",
      machine: "mbp",
      dir: "",
      visibility: "private",
      enabled: true,
      online: false,
      workspace_id: "",
    });
    expect(FileShareListSchema.parse({}).shares).toEqual([]);
  });

  it("keeps one share per machine and falls back on unknown visibility", () => {
    const shares = FileShareListSchema.parse({
      shares: [
        { daemon_id: "d-1", machine: "laptop", visibility: "public", future: true },
        { daemon_id: "d-2", machine: "desktop", visibility: "workspace" },
      ],
    }).shares;
    expect(shares.map((share) => [share.daemon_id, share.visibility])).toEqual([
      ["d-1", "private"],
      ["d-2", "workspace"],
    ]);
  });

  it("falls back on malformed responses", () => {
    expect(
      parseWithFallback(
        { shares: [{ machine: 42 }] },
        FileShareListSchema,
        { shares: [] },
        { endpoint: "GET /api/file-shares" },
      ).shares,
    ).toEqual([]);
  });
});
