// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonViewer } from "./json-viewer";

describe("JsonViewer", () => {
  it("expands nested objects and shows leaf values", async () => {
    const user = userEvent.setup();
    render(<JsonViewer value={{ request: { previous: "check" }, response: { choice: "追加" } }} />);
    expect(screen.getByText('"request"')).toBeInTheDocument();
    expect(screen.getByText('"previous"')).toBeInTheDocument();
    expect(screen.getByText('"check"')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /"response"/ }));
    expect(screen.queryByText('"choice"')).toBeNull();
    await user.click(screen.getByRole("button", { name: /"response"/ }));
    expect(screen.getByText('"追加"')).toBeInTheDocument();
  });
});
