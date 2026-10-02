// @vitest-environment node

import { describe, expect, it } from "vitest";
import { cancelledNoticeTrigger } from "./cancelled-notice";

describe("cancelledNoticeTrigger", () => {
  it("reads the quoted trigger", () => {
    expect(cancelledNoticeTrigger('```multica-cancelled\n{"trigger":"check the deploy"}\n```')).toBe(
      "check the deploy",
    );
  });

  it("keeps an empty trigger as a notice", () => {
    expect(cancelledNoticeTrigger('```multica-cancelled\n{"trigger":""}\n```')).toBe("");
  });

  it("ignores ordinary messages", () => {
    expect(cancelledNoticeTrigger("check the deploy")).toBeNull();
    expect(cancelledNoticeTrigger("```multica-cancelled\nnot json\n```")).toBeNull();
  });
});
