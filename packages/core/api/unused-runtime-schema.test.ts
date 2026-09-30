// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DeleteUnusedRuntimesResponseSchema,
  UnusedRuntimeListSchema,
} from "./schemas";
import { parseWithFallback } from "./schema";

describe("unused runtime cleanup response compatibility", () => {
  it("defaults missing lists to empty", () => {
    expect(UnusedRuntimeListSchema.parse({}).runtimes).toEqual([]);
    expect(DeleteUnusedRuntimesResponseSchema.parse({})).toMatchObject({
      deleted_ids: [],
      skipped_ids: [],
    });
  });

  it("keeps runtime ids and tolerates extra fields", () => {
    expect(
      UnusedRuntimeListSchema.parse({
        runtimes: [{ id: "rt-1", name: "Claude", future: true }],
      }).runtimes.map((runtime) => runtime.id),
    ).toEqual(["rt-1"]);
  });

  it("falls back on malformed responses", () => {
    expect(
      parseWithFallback(
        { runtimes: [{ id: 42 }] },
        UnusedRuntimeListSchema,
        { runtimes: [] },
        { endpoint: "GET /api/runtimes/unused" },
      ).runtimes,
    ).toEqual([]);
    expect(
      parseWithFallback(
        { deleted_ids: "rt-1" },
        DeleteUnusedRuntimesResponseSchema,
        { deleted_ids: [], skipped_ids: [] },
        { endpoint: "POST /api/runtimes/unused/delete" },
      ),
    ).toEqual({ deleted_ids: [], skipped_ids: [] });
  });
});
