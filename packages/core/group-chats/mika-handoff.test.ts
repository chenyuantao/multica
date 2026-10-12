// @vitest-environment node

import { describe, expect, it } from "vitest";
import { expectMikaTaskChat, takeMikaTaskChat } from "./mika-handoff";

describe("takeMikaTaskChat", () => {
  it("opens only the group started for the message just sent", () => {
    expectMikaTaskChat("comment-1");
    expect(takeMikaTaskChat("other")).toBe(false);
    expect(takeMikaTaskChat("comment-1")).toBe(true);
    expect(takeMikaTaskChat("comment-1")).toBe(false);
  });
});
