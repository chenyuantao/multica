"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// Named import, NOT default: see lark-tab.tsx for the CJS interop issue.
import { QRCode } from "react-qr-code";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { api, ApiError } from "@multica/core/api";
import { useCurrentWorkspace } from "@multica/core/paths";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import {
  useUnbindWechatClaw,
  wechatClawKeys,
  wechatClawStatusOptions,
} from "@multica/core/wechat-claw";
import type { WechatClawLoginStatus } from "@multica/core/types";
import { useT } from "../../i18n";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

const STATUS_RETRY_MS = 2000;

export function WechatClawTab() {
  const { t } = useT("settings");
  const currentWorkspace = useCurrentWorkspace();
  const status = useQuery(wechatClawStatusOptions());
  const workspaces = useQuery(workspaceListOptions());
  const unbind = useUnbindWechatClaw();

  const binding = status.data?.binding ?? null;
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [bindTarget, setBindTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const closeBindDialog = useCallback(() => setBindTarget(null), []);

  const workspaceItems = (workspaces.data ?? []).map((ws) => ({ value: ws.id, label: ws.name }));
  const selectedId =
    workspaceId ?? binding?.workspace_id ?? currentWorkspace?.id ?? workspaceItems[0]?.value ?? null;
  const selected = workspaceItems.find((item) => item.value === selectedId) ?? null;

  const handleUnbind = async () => {
    try {
      await unbind.mutateAsync();
      setConfirmUnbind(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.wechat_claw.unbind_failed));
    }
  };

  return (
    <SettingsTab
      title={t(($) => $.page.tabs.wechat_claw)}
      description={t(($) => $.wechat_claw.description)}
    >
      <SettingsSection>
        {status.isError ? (
          <p className="text-body text-destructive">{t(($) => $.wechat_claw.load_failed)}</p>
        ) : status.data && !status.data.available ? (
          <p className="text-body text-muted-foreground">{t(($) => $.wechat_claw.unavailable)}</p>
        ) : (
          <SettingsCard>
            {binding ? (
              <SettingsRow
                label={t(($) => $.wechat_claw.bound_label)}
                description={binding.workspace_name}
              >
                <Button variant="outline" size="sm" onClick={() => setConfirmUnbind(true)}>
                  {t(($) => $.wechat_claw.unbind)}
                </Button>
              </SettingsRow>
            ) : null}
            <SettingsRow
              label={
                binding
                  ? t(($) => $.wechat_claw.rebind_label)
                  : t(($) => $.wechat_claw.workspace_label)
              }
              description={binding ? t(($) => $.wechat_claw.rebind_hint) : undefined}
              size="select-wide"
            >
              <div className="flex items-center gap-2">
                <Select
                  items={workspaceItems}
                  value={selectedId}
                  onValueChange={(v) => {
                    if (v) setWorkspaceId(v);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-0 flex-1"
                    aria-label={t(($) => $.wechat_claw.workspace_label)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaceItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selected || status.isPending}
                  onClick={() => {
                    if (selected) setBindTarget({ id: selected.value, name: selected.label });
                  }}
                >
                  {binding ? t(($) => $.wechat_claw.rebind) : t(($) => $.wechat_claw.bind)}
                </Button>
              </div>
            </SettingsRow>
          </SettingsCard>
        )}
      </SettingsSection>

      {bindTarget ? (
        <WechatClawBindDialog
          key={bindTarget.id}
          workspaceId={bindTarget.id}
          workspaceName={bindTarget.name}
          onClose={closeBindDialog}
        />
      ) : null}

      <AlertDialog open={confirmUnbind} onOpenChange={setConfirmUnbind}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.wechat_claw.unbind_dialog.title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.wechat_claw.unbind_dialog.description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unbind.isPending}>
              {t(($) => $.wechat_claw.unbind_dialog.cancel)}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unbind.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleUnbind();
              }}
            >
              {t(($) => $.wechat_claw.unbind_dialog.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}

type BindPhase = WechatClawLoginStatus | "failed";

function WechatClawBindDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [phase, setPhase] = useState<BindPhase>("wait");

  const qrcode = useMutation({
    mutationFn: () => api.createWechatClawQRCode(workspaceId),
    onMutate: () => setPhase("wait"),
    onError: () => setPhase("failed"),
  });
  const session = qrcode.data ?? null;
  const requestQRCode = qrcode.mutate;

  useEffect(() => {
    requestQRCode();
  }, [requestQRCode]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const { signal } = controller;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });

    void (async () => {
      while (!signal.aborted) {
        try {
          const res = await api.getWechatClawQRCodeStatus(session.qrcode, signal);
          if (signal.aborted) return;
          setPhase(res.status);
          if (res.status === "confirmed") {
            await qc.invalidateQueries({ queryKey: wechatClawKeys.all() });
            toast.success(t(($) => $.wechat_claw.dialog.success));
            onClose();
            return;
          }
          if (res.status === "expired") return;
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof ApiError && e.status === 404) {
            setPhase("expired");
            return;
          }
          await sleep(STATUS_RETRY_MS);
        }
      }
    })();

    return () => controller.abort();
  }, [session, qc, onClose, t]);

  const message =
    phase === "failed"
      ? t(($) => $.wechat_claw.dialog.failed)
      : phase === "expired"
        ? t(($) => $.wechat_claw.dialog.expired)
        : phase === "scanned"
          ? t(($) => $.wechat_claw.dialog.scanned)
          : !session
            ? t(($) => $.wechat_claw.dialog.loading)
            : null;
  const canRetry = phase === "failed" || phase === "expired";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(($) => $.wechat_claw.dialog.title)}</DialogTitle>
          <DialogDescription>
            {t(($) => $.wechat_claw.dialog.description, { workspace: workspaceName })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="flex size-[218px] items-center justify-center rounded-md border bg-white p-3">
            {session && !canRetry ? (
              <QRCode
                value={session.url}
                size={192}
                aria-label={t(($) => $.wechat_claw.dialog.qr_label)}
              />
            ) : null}
          </div>
          {message ? (
            <p role="status" className="text-center text-body text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t(($) => $.wechat_claw.dialog.close)}
          </Button>
          {canRetry ? (
            <Button onClick={() => requestQRCode()} disabled={qrcode.isPending}>
              {t(($) => $.wechat_claw.dialog.regenerate)}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
