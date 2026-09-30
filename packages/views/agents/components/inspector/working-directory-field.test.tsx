// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import enAgents from "../../../locales/en/agents.json";
import enCommon from "../../../locales/en/common.json";
import { WorkingDirectorySettingField } from "./working-directory-field";

function renderField(value = "") {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <I18nProvider
      locale="en"
      resources={{ en: { common: enCommon, agents: enAgents } }}
    >
      <WorkingDirectorySettingField value={value} canEdit onSave={onSave} />
    </I18nProvider>,
  );
  const input = screen.getByRole("textbox", { name: "Working directory" });
  return { input, onSave };
}

describe("WorkingDirectorySettingField", () => {
  afterEach(() => cleanup());

  it("saves the trimmed absolute path on blur", () => {
    const { input, onSave } = renderField();

    fireEvent.change(input, { target: { value: "  /srv/proj  " } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith("/srv/proj");
  });

  it("saves on Enter", () => {
    const { input, onSave } = renderField();

    fireEvent.change(input, { target: { value: "C:\\code\\proj" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith("C:\\code\\proj");
  });

  it("keeps a relative path local and explains why", () => {
    const { input, onSave } = renderField();

    fireEvent.change(input, { target: { value: "code/proj" } });
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter an absolute path.")).toBeInTheDocument();
  });

  it("clears the saved path when emptied", () => {
    const { input, onSave } = renderField("/srv/proj");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith("");
  });

  it("does not save an unchanged value", () => {
    const { input, onSave } = renderField("/srv/proj");

    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
  });
});
