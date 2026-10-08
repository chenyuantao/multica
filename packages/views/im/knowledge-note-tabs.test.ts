// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  closeKnowledgeNote,
  EMPTY_KNOWLEDGE_NOTE_TABS,
  knowledgeNoteTabsFor,
  openKnowledgeNote,
  retainOpenNotes,
  updateKnowledgeNoteTabs,
} from "./knowledge-note-tabs";

const weekly = { path: "Work/周报.md", name: "周报" };
const plan = { path: "Work/计划.md", name: "计划" };

describe("knowledge note tabs", () => {
  it("opens notes after the details tab and focuses the newest one", () => {
    const first = openKnowledgeNote(EMPTY_KNOWLEDGE_NOTE_TABS, weekly);
    const second = openKnowledgeNote(first, plan);
    expect(second.notes).toEqual([weekly, plan]);
    expect(second.activePath).toBe(plan.path);
  });

  it("refocuses a note that is already open and keeps its place", () => {
    const opened = openKnowledgeNote(openKnowledgeNote(EMPTY_KNOWLEDGE_NOTE_TABS, weekly), plan);
    const again = openKnowledgeNote(opened, { ...weekly, name: "本周周报" });
    expect(again.notes.map((note) => note.name)).toEqual(["本周周报", "计划"]);
    expect(again.activePath).toBe(weekly.path);
  });

  it("selects the following note when the active one closes, then the details tab", () => {
    const opened = openKnowledgeNote(openKnowledgeNote(EMPTY_KNOWLEDGE_NOTE_TABS, weekly), plan);
    const closed = closeKnowledgeNote(opened, weekly.path);
    expect(closed.notes).toEqual([plan]);
    expect(closed.activePath).toBe(plan.path);
    expect(closeKnowledgeNote(closed, plan.path)).toEqual(EMPTY_KNOWLEDGE_NOTE_TABS);
  });
});

describe("knowledge note tabs per chat", () => {
  it("keeps each chat's open tabs and the selected one", () => {
    const launch = updateKnowledgeNoteTabs({}, "launch", (tabs) => openKnowledgeNote(tabs, weekly));
    const both = updateKnowledgeNoteTabs(launch, "standup", (tabs) => openKnowledgeNote(tabs, plan));
    const launchOnDetails = updateKnowledgeNoteTabs(both, "launch", (tabs) => ({ ...tabs, activePath: null }));

    expect(knowledgeNoteTabsFor(launchOnDetails, "launch")).toEqual({ notes: [weekly], activePath: null });
    expect(knowledgeNoteTabsFor(launchOnDetails, "standup")).toEqual({ notes: [plan], activePath: plan.path });
    expect(knowledgeNoteTabsFor(launchOnDetails, "other")).toEqual(EMPTY_KNOWLEDGE_NOTE_TABS);
    expect(knowledgeNoteTabsFor(launchOnDetails, null)).toEqual(EMPTY_KNOWLEDGE_NOTE_TABS);
  });

  it("drops a chat once its last note closes", () => {
    const opened = updateKnowledgeNoteTabs({}, "launch", (tabs) => openKnowledgeNote(tabs, weekly));
    expect(updateKnowledgeNoteTabs(opened, "launch", (tabs) => closeKnowledgeNote(tabs, weekly.path))).toEqual({});
  });
});

describe("retainOpenNotes", () => {
  it("keeps other chats mounted and drops a chat whose notes are all closed", () => {
    const launch = retainOpenNotes({}, "launch", [weekly]);
    const both = retainOpenNotes(launch, "standup", [plan]);
    expect(both).toEqual({ launch: [weekly], standup: [plan] });
    expect(retainOpenNotes(both, "standup", [plan])).toBe(both);
    expect(retainOpenNotes(both, "launch", [])).toEqual({ standup: [plan] });
  });
});
