"use client";

import { useEffect, useState } from "react";
import { isValidAgentWorkingDirectory } from "@multica/core/agents";
import { isImeComposing } from "@multica/core/utils";
import { Input } from "@multica/ui/components/ui/input";
import { useT } from "../../../i18n";
import { SettingsRow } from "../../../settings/components/settings-layout";

export function WorkingDirectoryInput({
  id,
  value,
  onChange,
  onCommit,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Called on blur and Enter; omit for drafts that are saved elsewhere. */
  onCommit?: () => void;
  disabled?: boolean;
}) {
  const { t } = useT("agents");
  const invalid = !isValidAgentWorkingDirectory(value);
  const messageId = `${id}-message`;
  return (
    <div>
      <Input
        id={id}
        name="agent-working-directory"
        autoComplete="off"
        spellCheck={false}
        aria-label={t(($) => $.working_directory.label)}
        aria-invalid={invalid || undefined}
        aria-describedby={messageId}
        value={value}
        placeholder={t(($) => $.working_directory.placeholder)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (!onCommit || isImeComposing(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
        }}
        className="font-mono"
      />
      <p
        id={messageId}
        className={
          invalid
            ? "mt-1 text-caption text-destructive"
            : "mt-1 text-caption text-muted-foreground"
        }
      >
        {invalid
          ? t(($) => $.working_directory.invalid)
          : t(($) => $.working_directory.hint)}
      </p>
    </div>
  );
}

export function WorkingDirectorySettingField({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const { t } = useT("agents");
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (!isValidAgentWorkingDirectory(next) || next === value) return;
    void onSave(next);
  };

  return (
    <SettingsRow
      label={t(($) => $.working_directory.label)}
      size="text"
      align="start"
    >
      <WorkingDirectoryInput
        id="agent-working-directory"
        value={draft}
        onChange={setDraft}
        onCommit={commit}
        disabled={!canEdit}
      />
    </SettingsRow>
  );
}
