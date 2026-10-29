"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";
import { toast } from "sonner";
import { useT } from "../../i18n";
import { IMindPromptSettings } from "./imind-prompt-settings";
import { SettingsRow } from "./settings-layout";

export function IMindAISettings({ wsId, canManage, agents }: { wsId: string; canManage: boolean; agents: { id: string; name: string }[] }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [keyDraft, setKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: configured = false } = useQuery({ queryKey: ["imind", "deepseek", wsId], queryFn: () => api.getIMindDeepSeek() });
  const { data: agentId = null } = useQuery({ queryKey: ["imind", "clip-agent", wsId], queryFn: () => api.getIMindClipAgent() });
  const automatic = t(($) => $.workspace.imind_default_agent_automatic);
  const unavailable = t(($) => $.workspace.imind_default_agent_unavailable);
  const missing = agentId && !agents.some((agent) => agent.id === agentId);
  const saveKey = async (value: string) => {
    setSaving(true);
    try {
      await api.setIMindDeepSeek(value);
      setKeyDraft("");
      await qc.invalidateQueries({ queryKey: ["imind", "deepseek", wsId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.workspace.imind_default_agent_save_failed));
    } finally { setSaving(false); }
  };
  return <>
    <SettingsRow anchor="imind-clip-agent" label={t(($) => $.workspace.imind_clip_agent_label)}>
      <Select
        items={[{ value: "", label: automatic }, ...(missing ? [{ value: agentId, label: unavailable }] : []), ...agents.map((agent) => ({ value: agent.id, label: agent.name }))]}
        value={agentId ?? ""}
        disabled={!canManage}
        onValueChange={async (value) => {
          try {
            await api.setIMindClipAgent(value || null);
            await qc.invalidateQueries({ queryKey: ["imind", "clip-agent", wsId] });
          } catch (error) { toast.error(error instanceof Error ? error.message : t(($) => $.workspace.imind_default_agent_save_failed)); }
        }}>
        <SelectTrigger aria-label={t(($) => $.workspace.imind_clip_agent_label)} className="min-w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="">{automatic}</SelectItem>
          {missing ? <SelectItem value={agentId} disabled>{unavailable}</SelectItem> : null}
          {agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </SettingsRow>
    <SettingsRow anchor="imind-deepseek" label={t(($) => $.workspace.imind_deepseek_label)} description={t(($) => $.workspace.imind_deepseek_help)}>
      <div className="flex w-full max-w-sm flex-col gap-2">
        <span className="text-muted-foreground">{configured ? t(($) => $.workspace.imind_key_configured) : t(($) => $.workspace.imind_key_missing)}</span>
        {canManage ? <form onSubmit={(event) => { event.preventDefault(); void saveKey(keyDraft); }} className="flex flex-wrap gap-2">
          <Input type="password" aria-label={t(($) => $.workspace.imind_deepseek_label)} autoComplete="new-password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} disabled={saving} />
          <Button type="submit" disabled={saving || !keyDraft.trim()} aria-busy={saving}>{t(($) => $.workspace.imind_key_save)}</Button>
          {configured ? <Button type="button" variant="outline" disabled={saving} onClick={() => void saveKey("")}>{t(($) => $.workspace.imind_key_clear)}</Button> : null}
        </form> : null}
      </div>
    </SettingsRow>
    <IMindPromptSettings wsId={wsId} canManage={canManage} />
  </>;
}
