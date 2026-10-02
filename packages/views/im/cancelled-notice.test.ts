// @vitest-environment node

import { describe, expect, it } from "vitest";
import { cancelledNoticeTrigger, parseCancelledNotice } from "./cancelled-notice";

describe("parseCancelledNotice", () => {
  it("reads the quoted trigger and Jev exchange", () => {
    expect(
      parseCancelledNotice(
        '```multica-cancelled\n{"trigger":"check the deploy","request":{"state":{"previous":"a"}},"response":{"relation":{"choice":"追加"}}}\n```',
      ),
    ).toEqual({
      trigger: "check the deploy",
      request: { state: { previous: "a" } },
      response: { relation: { choice: "追加" } },
    });
  });

  it("keeps an empty trigger as a notice", () => {
    expect(parseCancelledNotice('```multica-cancelled\n{"trigger":""}\n```')).toEqual({
      trigger: "",
      request: undefined,
      response: undefined,
    });
  });

  it("ignores ordinary messages", () => {
    expect(parseCancelledNotice("check the deploy")).toBeNull();
    expect(parseCancelledNotice("```multica-cancelled\nnot json\n```")).toBeNull();
    expect(cancelledNoticeTrigger("hello")).toBeNull();
    expect(cancelledNoticeTrigger('```multica-cancelled\n{"trigger":"x"}\n```')).toBe("x");
  });
});
