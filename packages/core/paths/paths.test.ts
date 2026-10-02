import { describe, it, expect } from "vitest";
import { paths, isGlobalPath } from "./paths";

describe("paths.workspace(slug)", () => {
  const ws = paths.workspace("acme");

  it("builds workspace paths with slug prefix", () => {
    expect(ws.root()).toBe("/acme");
    expect(ws.member()).toBe("/acme/member");
    expect(ws.memberSearch()).toBe("/acme/member?view=search");
    expect(ws.imSearch()).toBe("/acme/im?view=search");
    expect(ws.knowledgeSearch()).toBe("/acme/knowledge?view=search");
    expect(ws.imNewChat()).toBe("/acme/im?view=new");
    expect(ws.memberNewAgent()).toBe("/acme/member?view=new-agent");
    expect(ws.knowledgeNewNote("")).toBe("/acme/knowledge?view=new");
    expect(ws.knowledgeNewNote("a/b")).toBe("/acme/knowledge?view=new&dir=a%2Fb");
    expect(ws.memberContact("agent", "a1")).toBe("/acme/member?contact=agent%3Aa1");
    expect(ws.imChat("c1")).toBe("/acme/im?chat=c1");
    expect(ws.imChatHistory("c1", "m1")).toBe("/acme/im?chat=c1&view=history&message=m1");
    expect(ws.imChatProgress("c1", "t1")).toBe("/acme/im?chat=c1&view=progress&task=t1");
    expect(ws.imChatHistory("c1", "m1", "0.1")).toBe("/acme/im?chat=c1&view=history&message=m1&nest=0.1");
    expect(ws.imChatContact("c1", "member", "u1")).toBe("/acme/im?chat=c1&contact=member%3Au1");
    expect(ws.memberChat("c1")).toBe("/acme/member?chat=c1");
    expect(ws.memberChatContact("c1", "agent", "a1")).toBe("/acme/member?chat=c1&contact=agent%3Aa1");
    expect(ws.imChatSettingsContact("c1", "agent", "a1")).toBe(
      "/acme/im?chat=c1&view=settings&contact=agent%3Aa1",
    );
    expect(ws.knowledge()).toBe("/acme/knowledge");
    expect(ws.knowledgeFile("库/笔记 1.md")).toBe("/acme/knowledge?file=%E5%BA%93%2F%E7%AC%94%E8%AE%B0%201.md");
    expect(ws.usage()).toBe("/acme/usage");
    expect(ws.issues()).toBe("/acme/issues");
    expect(ws.issueDetail("abc-123")).toBe("/acme/issues/abc-123");
    expect(ws.projects()).toBe("/acme/projects");
    expect(ws.projectDetail("p1")).toBe("/acme/projects/p1");
    expect(ws.autopilots()).toBe("/acme/autopilots");
    expect(ws.autopilotDetail("a1")).toBe("/acme/autopilots/a1");
    expect(ws.agents()).toBe("/acme/agents");
    expect(ws.newAgent()).toBe("/acme/agents/new");
    expect(ws.newAgentAi()).toBe("/acme/agents/new/ai");
    expect(ws.newAgentAiSession("sess_1")).toBe("/acme/agents/new/ai/sess_1");
    expect(ws.memberDetail("u1")).toBe("/acme/members/u1");
    expect(ws.inbox()).toBe("/acme/inbox");
    expect(ws.chatWithAgent("agent one")).toBe(
      "/acme/chat?agent=agent%20one",
    );
    expect(ws.chatSession("session one")).toBe(
      "/acme/chat?session=session%20one",
    );
    expect(ws.myIssues()).toBe("/acme/my-issues");
    expect(ws.runtimes()).toBe("/acme/runtimes");
    expect(ws.runtimeSettings("machine/runtime", "runtime one")).toBe(
      "/acme/runtimes/machine%2Fruntime/runtime/runtime%20one",
    );
    expect(ws.skills()).toBe("/acme/skills");
    expect(ws.skillDetail("skl_123")).toBe("/acme/skills/skl_123");
    expect(ws.squads()).toBe("/acme/squads");
    expect(ws.squadDetail("sq_1")).toBe("/acme/squads/sq_1");
    expect(ws.settings()).toBe("/acme/settings");
    expect(ws.attachmentPreview("att_42")).toBe("/acme/attachments/att_42/preview");
  });

  it("URL-encodes special characters in ids", () => {
    expect(ws.issueDetail("id with space")).toBe("/acme/issues/id%20with%20space");
  });
});

describe("paths (global)", () => {
  it("builds global paths without slug", () => {
    expect(paths.login()).toBe("/login");
    expect(paths.newWorkspace()).toBe("/workspaces/new");
    expect(paths.invite("inv-1")).toBe("/invite/inv-1");
    expect(paths.authCallback()).toBe("/auth/callback");
  });
});

describe("isGlobalPath", () => {
  it("returns true for pre-workspace routes", () => {
    expect(isGlobalPath("/login")).toBe(true);
    expect(isGlobalPath("/workspaces/new")).toBe(true);
    expect(isGlobalPath("/invite/abc")).toBe(true);
    expect(isGlobalPath("/auth/callback")).toBe(true);
  });

  it("returns false for workspace-scoped paths", () => {
    expect(isGlobalPath("/acme/issues")).toBe(false);
    expect(isGlobalPath("/")).toBe(false);
  });
});
