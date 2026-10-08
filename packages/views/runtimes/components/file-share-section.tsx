"use client";

import { useQuery } from "@tanstack/react-query";
import { Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { fileShareListOptions, useUpdateFileShare } from "@multica/core/file-shares";
import type { FileShare, UpdateFileShareRequest } from "@multica/core/types";
import { Switch } from "@multica/ui/components/ui/switch";
import { useT } from "../../i18n";
import type { RuntimeMachine } from "./runtime-machines";
import { splitRuntimeName } from "./runtime-machines";

/** True when this share is the directory published by the machine on screen. */
export function fileShareMatchesMachine(share: FileShare, machine: RuntimeMachine): boolean {
  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) names.add(trimmed);
  };
  add(machine.title);
  add(machine.deviceInfo);
  if (machine.deviceInfo) add(machine.deviceInfo.split(" · ")[0]);
  for (const runtime of machine.runtimes) {
    add(runtime.device_info);
    if (runtime.device_info) add(runtime.device_info.split(" · ")[0]);
    add(splitRuntimeName(runtime.name).hostname);
  }
  return names.has(share.machine);
}

export function FileShareSection({
  wsId,
  machine,
}: {
  wsId: string;
  /** When set, only the share for this machine is shown. */
  machine?: RuntimeMachine | null;
}) {
  const { data: shares = [] } = useQuery(fileShareListOptions(wsId));
  const visible = machine ? shares.filter((share) => fileShareMatchesMachine(share, machine)) : shares;
  if (visible.length === 0) return null;
  return (
    <div className="mb-6 space-y-3">
      {visible.map((share) => (
        <FileShareCard key={share.machine} wsId={wsId} share={share} />
      ))}
    </div>
  );
}

function FileShareCard({ wsId, share }: { wsId: string; share: FileShare }) {
  const { t } = useT("runtimes");
  const update = useUpdateFileShare(wsId);
  const patch = (next: UpdateFileShareRequest) => {
    update.mutate(
      { machine: share.machine, patch: next },
      {
        onSuccess: () => toast.success(t(($) => $.file_share.saved)),
        onError: () => toast.error(t(($) => $.file_share.failed)),
      },
    );
  };

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-body font-semibold">{t(($) => $.file_share.title)}</h2>
        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${share.online ? "bg-success" : "bg-muted-foreground/50"}`}
          />
          {share.online ? t(($) => $.file_share.online) : t(($) => $.file_share.offline)}
        </span>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <div className="text-micro uppercase tracking-wider text-muted-foreground">
            {t(($) => $.file_share.path)}
          </div>
          <p className="mt-1 break-all font-mono text-caption">{share.dir || "—"}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-body">{t(($) => $.file_share.access)}</span>
          <Switch
            checked={share.enabled}
            disabled={update.isPending}
            aria-label={t(($) => $.file_share.access)}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>
        <div>
          <div className="mb-1.5 text-micro uppercase tracking-wider text-muted-foreground">
            {t(($) => $.file_share.visibility)}
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            <VisibilityChoice
              active={share.visibility !== "workspace"}
              icon={<Lock className="h-3 w-3" />}
              label={t(($) => $.file_share.private)}
              disabled={update.isPending}
              onClick={() => patch({ visibility: "private" })}
            />
            <VisibilityChoice
              active={share.visibility === "workspace"}
              icon={<Globe className="h-3 w-3" />}
              label={t(($) => $.file_share.workspace)}
              disabled={update.isPending}
              onClick={() => patch({ visibility: "workspace" })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function VisibilityChoice({
  active,
  icon,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-xs px-2 py-1 text-caption font-medium transition-colors ${
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}
