"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import type { IMindPrompts } from "@multica/core/api/schemas";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { toast } from "sonner";
import { useT } from "../../i18n";
import { SettingsRow } from "./settings-layout";

const promptKey = (wsId: string) => ["imind", "prompts", wsId];

export function IMindPromptSettings({ wsId, canManage }: { wsId: string; canManage: boolean }) {
  const { t } = useT("settings");
  const { data, isPending, isError, refetch } = useQuery({ queryKey: promptKey(wsId), queryFn: () => api.getIMindPrompts() });
  const labels = {
    file_title: t(($) => $.workspace.imind_prompts.file_title),
    recording_title: t(($) => $.workspace.imind_prompts.recording_title),
    processor: t(($) => $.workspace.imind_prompts.processor),
    clip: t(($) => $.workspace.imind_prompts.clip),
  };
  const variables: Record<string, string> = {
    FILE_CONTENT: t(($) => $.workspace.imind_prompts.variables.FILE_CONTENT),
    FILE_PATH: t(($) => $.workspace.imind_prompts.variables.FILE_PATH),
    FILE_RELATIVE_PATH: t(($) => $.workspace.imind_prompts.variables.FILE_RELATIVE_PATH),
    SHARE_MACHINE: t(($) => $.workspace.imind_prompts.variables.SHARE_MACHINE),
    FILE_TITLE: t(($) => $.workspace.imind_prompts.variables.FILE_TITLE),
    FILE_TYPE: t(($) => $.workspace.imind_prompts.variables.FILE_TYPE),
    FILE_ID: t(($) => $.workspace.imind_prompts.variables.FILE_ID),
    FILE_REVISION: t(($) => $.workspace.imind_prompts.variables.FILE_REVISION),
    FILE_BODY: t(($) => $.workspace.imind_prompts.variables.FILE_BODY),
    TRANSCRIPT: t(($) => $.workspace.imind_prompts.variables.TRANSCRIPT),
    SOURCE_URL: t(($) => $.workspace.imind_prompts.variables.SOURCE_URL),
    CLIP_ORIGINAL_TEXT: t(($) => $.workspace.imind_prompts.variables.CLIP_ORIGINAL_TEXT),
    CLIP_INSTRUCTIONS: t(($) => $.workspace.imind_prompts.variables.CLIP_INSTRUCTIONS),
  };
  return <>
    <SettingsRow size="text" align="start" label={t(($) => $.workspace.imind_prompts.label)} description={t(($) => $.workspace.imind_prompts.help)}>
      <div className="w-full min-w-0">
        {isPending ? <p role="status">{t(($) => $.workspace.imind_prompts.loading)}</p> : null}
        {isError || (data && data.prompts.length === 0) ? <div role="alert">
          <p>{t(($) => $.workspace.imind_prompts.load_failed)}</p>
          <Button variant="outline" onClick={() => void refetch()}>{t(($) => $.workspace.imind_prompts.retry)}</Button>
        </div> : null}
        {data && data.variables.length > 0 ? <details>
          <summary className="cursor-pointer">{t(($) => $.workspace.imind_prompts.variable_help)}</summary>
          <dl className="mt-2 flex flex-col gap-2 text-caption">
            {data.variables.map((name) => <div key={name}>
              <dt className="break-all font-mono">{`{{${name}}}`}</dt>
              <dd className="text-muted-foreground">{variables[name] ?? name}</dd>
            </div>)}
          </dl>
        </details> : null}
      </div>
    </SettingsRow>
    {data?.prompts.map((prompt) => <PromptEditor key={prompt.kind} wsId={wsId} prompt={prompt} label={labels[prompt.kind]} canManage={canManage} />)}
  </>;
}

function PromptEditor({ wsId, prompt, label, canManage }: { wsId: string; prompt: IMindPrompts["prompts"][number]; label: string; canManage: boolean }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? prompt.template;
  const save = async (template: string | null) => {
    setSaving(true);
    try {
      const result = await api.setIMindPrompt(prompt.kind, template);
      if (!result.prompts.some((item) => item.kind === prompt.kind)) throw new Error(t(($) => $.workspace.imind_prompts.save_failed));
      qc.setQueryData(promptKey(wsId), result);
      setDraft(null);
      toast.success(t(($) => $.workspace.imind_prompts.saved));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.workspace.imind_prompts.save_failed));
    } finally { setSaving(false); }
  };
  return <SettingsRow size="text" align="start" anchor={`imind-prompt-${prompt.kind}`} label={<label htmlFor={id}>{label}</label>}>
    <form className="flex w-full min-w-0 flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(value); }}>
      <Textarea id={id} value={value} onChange={(event) => setDraft(event.target.value)} readOnly={!canManage} disabled={saving} rows={9} className="max-h-96 resize-y font-mono" />
      {canManage ? <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || !value.trim() || value === prompt.template} aria-busy={saving}>{t(($) => $.workspace.imind_prompts.save)}</Button>
        <Button type="button" variant="outline" disabled={saving || (!prompt.custom && draft === null)} onClick={() => void save(null)}>{t(($) => $.workspace.imind_prompts.restore)}</Button>
      </div> : null}
    </form>
  </SettingsRow>;
}
