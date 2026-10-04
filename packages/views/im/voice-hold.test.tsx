// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "../test/i18n";
import { useVoiceHold } from "./voice-hold";

function Hold({ editable }: { editable: boolean }) {
  const voice = useVoiceHold({ enabled: true, onSend: () => {}, onEdit: () => {} });
  if (!editable) {
    return (
      <button
        type="button"
        onPointerDown={voice.onPointerDown}
        onPointerUp={voice.onPointerUp}
        onPointerCancel={voice.onPointerCancel}
      >
        talk
      </button>
    );
  }
  return (
    <div
      role="textbox"
      aria-label="composer"
      contentEditable={!voice.capturing}
      onPointerDown={voice.onPointerDown}
      onPointerUp={(event) => {
        voice.onPointerUp(event);
      }}
      onPointerCancel={voice.onPointerCancel}
    />
  );
}

describe("useVoiceHold", () => {
  it("does not make a button editable after a short press", () => {
    renderWithI18n(<Hold editable={false} />);
    const button = screen.getByRole("button", { name: "talk" });
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });
    fireEvent.pointerUp(button, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });
    expect(button).not.toHaveAttribute("contenteditable", "true");
  });

  it("gives a composer field its caret back after a short press", () => {
    renderWithI18n(<Hold editable />);
    const field = screen.getByRole("textbox", { name: "composer" });
    fireEvent.pointerDown(field, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });
    expect(field).toHaveAttribute("contenteditable", "false");
    fireEvent.pointerUp(field, { button: 0, pointerId: 1, clientX: 8, clientY: 8 });
    expect(field).toHaveAttribute("contenteditable", "true");
  });
});
