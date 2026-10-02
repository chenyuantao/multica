// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildSpeechCorpus } from "./speech-corpus";

describe("buildSpeechCorpus", () => {
  it("keeps the agent name and strips mention markdown", () => {
    expect(
      buildSpeechCorpus({
        agentName: "Ada",
        snippets: ["see [@Ada](mention://member/abc) about CODOC-8"],
      }),
    ).toBe("Ada\nsee @Ada about CODOC-8");
  });

  it("keeps the most recent tail when the transcript is long", () => {
    const snippets = ["a".repeat(1500), "b".repeat(1500)];
    const corpus = buildSpeechCorpus({ snippets });
    expect(corpus.length).toBeLessThanOrEqual(2000);
    expect(corpus.endsWith("b".repeat(100))).toBe(true);
  });
});
