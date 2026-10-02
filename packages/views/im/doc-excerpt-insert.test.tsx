// @vitest-environment jsdom

import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocExcerptInsertProvider, useInsertDocExcerpt, useRegisterDocExcerptInsert } from "./doc-excerpt-insert";

const weekly = { name: "本周周报", path: "notes/weekly.md", text: "周五发布" };

function Harness() {
  const insert = useInsertDocExcerpt();
  const register = useRegisterDocExcerptInsert();
  const seen = useRef(0);
  const [label, setLabel] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const placed = insert("chat-1", weekly);
          setLabel(placed ? `placed:${seen.current}` : "queued");
        }}
      >
        insert
      </button>
      <button
        type="button"
        onClick={() => {
          register("chat-1", () => {
            seen.current += 1;
          });
          setLabel(`registered:${seen.current}`);
        }}
      >
        register
      </button>
      <div>{label}</div>
    </>
  );
}

describe("doc excerpt insert", () => {
  it("waits until the chat composer is on screen, then delivers the passage", () => {
    render(
      <DocExcerptInsertProvider>
        <Harness />
      </DocExcerptInsertProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "insert" }));
    expect(screen.getByText("queued")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "register" }));
    expect(screen.getByText("registered:1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "insert" }));
    expect(screen.getByText("placed:2")).toBeInTheDocument();
  });
});
