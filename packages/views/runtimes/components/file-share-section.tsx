"use client";

import { useQuery } from "@tanstack/react-query";
import { FolderSymlink, Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { fileShareListOptions, useUpdateFileShare } from "@multica/core/file-shares";
import type { FileShare, UpdateFileShareRequest } from "@multica/core/types";
import { Switch } from "@multica/ui/components/ui/switch";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";
import type { RuntimeMachine } from "./runtime-machines";

const SHARE_COMMAND = "multica-file share <dir>";

/** The share published from this machine, matched by the multica daemon id its runtimes register under. */
export function fileShareForMachine(
  shares: FileShare[],
  machine: Pick<RuntimeMachine, "daemonId">,
): FileShare | null {
  if (!machine.daemonId) return null;
  return shares.find((share) => share.daemon_id === machine.daemonId) ?? null;
}

export function FileShareSection({
  wsId,
  machine,
  canSetUp,
}: {
  wsId: string;
  machine: RuntimeMachine;
  /** The viewer runs this machine, so an unshared machine shows how to start sharing. */
  canSetUp: boolean;
}) {
  const { data: shares = [] } = useQuery(fileShareListOptions(wsId));
  const share = fileShareForMachine(shares, machine);
  if (share) return <FileShareCard wsId={wsId} share={share} />;
  if (!canSetUp || !machine.daemonId) return null;
  return <FileShareSetup />;
}

/** Compact share state for a machine row in the runtime list. */
export function FileShareBadge({ share }: { share: FileShare }) {
  const { t } = useT("runtimes");
  const active = share.enabled && share.online;
  return (
    <span
      title={t(($) => $.file_share.title)}
      className={cn(
        "inline-flex min-w-0 shrink items-center gap-1 rounded-xs bg-muted px-1.5 py-0.5 text-micro font-medium",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <FolderSymlink aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {share.enabled ? `${share.machine}/` : t(($) => $.file_share.badge_off)}
      </span>
    </span>
  );
}

function SectionHeader({ status }: { status: React.ReactNode }) {
  const { t } = useT("runtimes");
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <h2 className="text-body font-semibold">{t(($) => $.file_share.title)}</h2>
      <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">{status}</span>
    </div>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-success" : "bg-muted-foreground/50")}
    />
  );
}

function FileShareSetup() {
  const { t } = useT("runtimes");
  return (
    <section className="mb-6 rounded-lg border bg-card">
      <SectionHeader
        status={
          <>
            <StatusDot on={false} />
            {t(($) => $.file_share.not_shared)}
          </>
        }
      />
      <div className="p-4">
        <p className="text-caption text-muted-foreground">{t(($) => $.file_share.setup_hint)}</p>
        <code className="mt-2 block break-all rounded-md bg-muted px-2 py-1.5 font-mono text-caption">
          {SHARE_COMMAND}
        </code>
      </div>
    </section>
  );
}

function FileShareCard({ wsId, share }: { wsId: string; share: FileShare }) {
  const { t } = useT("runtimes");
  const update = useUpdateFileShare(wsId);
  const patch = (next: UpdateFileShareRequest) => {
    update.mutate(
      { daemonId: share.daemon_id, patch: next },
      {
        onSuccess: () => toast.success(t(($) => $.file_share.saved)),
        onError: () => toast.error(t(($) => $.file_share.failed)),
      },
    );
  };

  return (
    <section className="mb-6 rounded-lg border bg-card">
      <SectionHeader
        status={
          <>
            <StatusDot on={share.online} />
            {share.online ? t(($) => $.file_share.online) : t(($) => $.file_share.offline)}
          </>
        }
      />
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="text-micro uppercase tracking-wider text-muted-foreground">
              {t(($) => $.file_share.knowledge_path)}
            </div>
            <p className="mt-1 break-all font-mono text-caption">{share.machine}/</p>
          </div>
          <div className="min-w-0">
            <div className="text-micro uppercase tracking-wider text-muted-foreground">
              {t(($) => $.file_share.path)}
            </div>
            <p className="mt-1 break-all font-mono text-caption">{share.dir || "—"}</p>
          </div>
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
