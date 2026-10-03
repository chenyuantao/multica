// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canDrop, dropDirectory, springOpenFolder } from "./knowledge-drag";

const file = (path: string) => ({ path, type: "file" as const });
const dir = (path: string) => ({ path, type: "dir" as const });

describe("dropDirectory", () => {
  it("moves a note into a folder, or beside a note into that note's folder", () => {
    expect(dropDirectory(file("readme.md"), dir("Strategy"))).toBe("Strategy");
    expect(dropDirectory(file("readme.md"), file("Strategy/budget.md"))).toBe("Strategy");
    expect(dropDirectory(dir("Archive"), file("Strategy/budget.md"))).toBe("Strategy");
  });

  it("rejects a no-op and a folder dropped into itself", () => {
    expect(dropDirectory(file("Strategy/budget.md"), dir("Strategy"))).toBeNull();
    expect(dropDirectory(file("readme.md"), file("other.md"))).toBeNull();
    expect(dropDirectory(dir("Strategy"), dir("Strategy"))).toBeNull();
    expect(dropDirectory(dir("Strategy"), dir("Strategy/2025"))).toBeNull();
    expect(canDrop(dir("Strategy/2025"), "")).toBe(true);
    expect(canDrop(file("readme.md"), "")).toBe(false);
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
