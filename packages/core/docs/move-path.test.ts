// @vitest-environment node
import { describe, expect, it } from "vitest";
import { relocatedDocPath } from "./move-path";

describe("relocatedDocPath", () => {
  it("rewrites the moved note and everything inside a moved folder", () => {
    expect(relocatedDocPath("库/笔记.md", "库/笔记.md", "归档/笔记.md")).toBe("归档/笔记.md");
    expect(relocatedDocPath("项目/计划/Q3.md", "项目", "归档/项目")).toBe("归档/项目/计划/Q3.md");
  });

  it("leaves notes outside the move, and a no-op move, alone", () => {
    expect(relocatedDocPath("其他.md", "库/笔记.md", "归档/笔记.md")).toBeNull();
    expect(relocatedDocPath("项目说明.md", "项目", "归档/项目")).toBeNull();
    expect(relocatedDocPath("库/笔记.md", "库/笔记.md", "库/笔记.md")).toBeNull();
  });
});
