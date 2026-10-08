// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canDrop, dropDirectory, springOpenFolder } from "./knowledge-drag";

const file = (path: string) => ({ path, type: "file" as const });
const dir = (path: string) => ({ path, type: "dir" as const });

describe("dropDirectory", () => {
  it("moves a note into a folder, or beside a note into that note's folder", () => {
    expect(dropDirectory(file("mbp/readme.md"), dir("mbp/Strategy"))).toBe("mbp/Strategy");
    expect(dropDirectory(file("mbp/readme.md"), file("mbp/Strategy/budget.md"))).toBe("mbp/Strategy");
    expect(dropDirectory(dir("mbp/Archive"), file("mbp/Strategy/budget.md"))).toBe("mbp/Strategy");
    expect(canDrop(dir("mbp/Strategy/2025"), "mbp")).toBe(true);
  });

  it("rejects a no-op and a folder dropped into itself", () => {
    expect(dropDirectory(file("mbp/Strategy/budget.md"), dir("mbp/Strategy"))).toBeNull();
    expect(dropDirectory(file("mbp/readme.md"), file("mbp/other.md"))).toBeNull();
    expect(dropDirectory(dir("mbp/Strategy"), dir("mbp/Strategy"))).toBeNull();
    expect(dropDirectory(dir("mbp/Strategy"), dir("mbp/Strategy/2025"))).toBeNull();
  });

  it("keeps entries on their machine and machine roots in place", () => {
    expect(dropDirectory(file("mbp/readme.md"), dir("studio/Inbox"))).toBeNull();
    expect(dropDirectory(file("mbp/readme.md"), dir("studio"))).toBeNull();
    expect(dropDirectory(dir("mbp"), dir("studio/Inbox"))).toBeNull();
    expect(canDrop(file("mbp/Strategy/budget.md"), "")).toBe(false);
  });
});

describe("springOpenFolder", () => {
  it("opens a collapsed folder and ignores files and folders already open", () => {
    expect(springOpenFolder(file("readme.md"), dir("Strategy/2025"), false)).toBe("Strategy/2025");
    expect(springOpenFolder(file("readme.md"), dir("Strategy"), true)).toBeNull();
    expect(springOpenFolder(file("readme.md"), file("Strategy/budget.md"), false)).toBeNull();
  });

  it("does not open the folder being dragged or anything inside it", () => {
    expect(springOpenFolder(dir("Strategy"), dir("Strategy"), false)).toBeNull();
    expect(springOpenFolder(dir("Strategy"), dir("Strategy/2025"), false)).toBeNull();
    expect(springOpenFolder(dir("Archive"), dir("Strategy"), false)).toBe("Strategy");
  });
});
