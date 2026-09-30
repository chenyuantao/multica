import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColumnResizeHandle, useColumnWidth } from "./resizable-column";

const OPTIONS = { defaultWidth: 256, min: 200, max: 480 };

function Column({ edge = "right" as "left" | "right" }) {
  const { width, commit, options } = useColumnWidth("test", OPTIONS);
  return (
    <div data-testid="column" style={{ width }}>
      <ColumnResizeHandle edge={edge} width={width} options={options} onCommit={commit} label="Resize" />
    </div>
  );
}

function drag(handle: HTMLElement, from: number, to: number) {
  const column = handle.parentElement!;
  const startWidth = Number.parseFloat(column.style.width);
  column.getBoundingClientRect = () => ({ width: startWidth }) as DOMRect;
  fireEvent.pointerDown(handle, { button: 0, isPrimary: true, pointerId: 1, clientX: from });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: to });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: to });
}

describe("resizable IM column", () => {
  afterEach(() => localStorage.clear());

  it("commits and persists a dragged width", () => {
    render(<Column />);
    const handle = screen.getByRole("separator", { name: "Resize" });
    drag(handle, 100, 164);
    expect(screen.getByTestId("column").style.width).toBe("320px");
    expect(handle).toHaveAttribute("aria-valuenow", "320");
    expect(localStorage.getItem("multica:im-column-width:test")).toBe("320");
  });

  it("grows a left-edge column when dragged left and clamps to the maximum", () => {
    render(<Column edge="left" />);
    drag(screen.getByRole("separator"), 500, 100);
    expect(screen.getByTestId("column").style.width).toBe("480px");
  });

  it("restores the stored width and supports keyboard resizing", () => {
    localStorage.setItem("multica:im-column-width:test", "300");
    render(<Column />);
    const handle = screen.getByRole("separator");
    expect(screen.getByTestId("column").style.width).toBe("300px");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(screen.getByTestId("column").style.width).toBe("284px");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(screen.getByTestId("column").style.width).toBe("200px");
    fireEvent.doubleClick(handle);
    expect(screen.getByTestId("column").style.width).toBe("256px");
  });
});
