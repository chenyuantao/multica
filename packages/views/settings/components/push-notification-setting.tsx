"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getWebNotificationPermission,
  getWebPushSubscription,
  getWebPushSupport,
  type WebPushSupport,
} from "@multica/core/platform";
import {
  pushConfigOptions,
  useDisableWebPush,
  useEnableWebPush,
  WebPushPermissionError,
} from "@multica/core/push";
import { Button } from "@multica/ui/components/ui/button";
import { toast } from "sonner";
import { isDesktopShell } from "../../platform";
import { useT } from "../../i18n";
import { SettingsCard, SettingsRow } from "./settings-layout";

/**
 * Web-only: subscribes this device to Web Push. Renders nothing on desktop
 * (which has its own OS banners), when the server has no VAPID key, or where
 * the Push API is missing outside iOS Safari (which needs a Home Screen
 * install first).
 */
export function PushNotificationSetting() {
  const { t } = useT("settings");
  const [support, setSupport] = useState<WebPushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const desktop = isDesktopShell();
  const { data: config } = useQuery({ ...pushConfigOptions(), enabled: !desktop });
  const enable = useEnableWebPush();
  const disable = useDisableWebPush();

  useEffect(() => {
    const next = getWebPushSupport();
    setSupport(next);
    setDenied(getWebNotificationPermission() === "denied");
    if (next !== "supported") return;
    let cancelled = false;
    void getWebPushSubscription()
      .then((subscription) => {
        if (!cancelled) setSubscribed(subscription !== null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const publicKey = config?.web_push_public_key ?? "";
  if (desktop || !publicKey || support === null || support === "unsupported") return null;

  const handleEnable = () => {
    enable.mutate(publicKey, {
      onSuccess: () => setSubscribed(true),
      onError: (err) => {
        if (err instanceof WebPushPermissionError) {
          setDenied(err.permission === "denied");
          return;
        }
        toast.error(t(($) => $.notifications.push.toast_enable_failed));
      },
    });
  };

  const handleDisable = () => {
    disable.mutate(undefined, {
      onSuccess: () => setSubscribed(false),
      onError: () => toast.error(t(($) => $.notifications.push.toast_disable_failed)),
    });
  };

  const description =
    support === "requires-install"
      ? t(($) => $.notifications.push.install_hint)
      : denied
        ? t(($) => $.notifications.push.denied)
        : t(($) => $.notifications.push.hint);
  const pending = enable.isPending || disable.isPending;

  return (
    <SettingsCard>
      <SettingsRow
        anchor="push"
        label={t(($) => $.notifications.push.label)}
        description={description}
      >
        {support === "supported" && !denied && (
          subscribed ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={handleDisable}>
              {t(($) => $.notifications.push.disable)}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={handleEnable}>
              {t(($) => $.notifications.push.enable)}
            </Button>
          )
        )}
      </SettingsRow>
    </SettingsCard>
  );
}
