"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getWebNotificationPermission,
  getWebPushSupport,
  isWebNotificationSupported,
  type WebNotificationPermission,
  requestWebNotificationPermission,
} from "@multica/core/platform";
import {
  pushConfigOptions,
  useEnableWebPush,
  WebPushPermissionError,
} from "@multica/core/push";
import { Button } from "@multica/ui/components/ui/button";
import { toast } from "sonner";
import { isDesktopShell } from "../../platform";
import { useT } from "../../i18n";
import { SettingsCard, SettingsRow } from "./settings-layout";

/**
 * Web-only control for the browser permission that notification banners
 * require. Enabling it also subscribes this device to Web Push when the
 * server has a VAPID key, so a banner still arrives after the site is
 * closed. Desktop delivers banners through the OS via Electron (no browser
 * permission involved), so this renders nothing there. It also renders
 * nothing when the Notification API is unavailable (SSR, older browsers).
 *
 * Capability and permission are read from `window`, so the first paint defers
 * to a post-mount effect to keep SSR and client markup identical (no hydration
 * mismatch).
 */
export function BrowserNotificationSetting() {
  const { t } = useT("settings");
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] =
    useState<WebNotificationPermission>("default");
  const desktop = isDesktopShell();
  const { data: config, isSuccess, isError } = useQuery({
    ...pushConfigOptions(),
    enabled: mounted && !desktop,
  });
  const configReady = isSuccess || isError;
  const enablePush = useEnableWebPush();

  useEffect(() => {
    setMounted(true);
    setPermission(getWebNotificationPermission());
  }, []);

  // Pre-mount, on desktop, or where the API is missing → nothing to manage.
  if (!mounted || desktop || !isWebNotificationSupported()) return null;

  const handleEnable = () => {
    const publicKey = config?.web_push_public_key ?? "";
    // One gesture covers the permission prompt and the push subscription.
    // Safari shows the prompt only inside the click.
    if (publicKey && getWebPushSupport() === "supported") {
      enablePush.mutate(publicKey, {
        onSuccess: () => setPermission("granted"),
        onError: (err) => {
          const next = getWebNotificationPermission();
          setPermission(next === "unsupported" ? "default" : next);
          if (err instanceof WebPushPermissionError) return;
          toast.error(t(($) => $.notifications.push.toast_enable_failed));
        },
      });
      return;
    }
    void requestWebNotificationPermission().then(setPermission);
  };

  const statusHint =
    permission === "granted"
      ? t(($) => $.notifications.browser.granted)
      : permission === "denied"
        ? t(($) => $.notifications.browser.denied)
        : t(($) => $.notifications.browser.hint);

  return (
    <SettingsCard>
      <SettingsRow
        anchor="browser"
        label={t(($) => $.notifications.browser.label)}
        description={statusHint}
      >
          {permission === "default" && (
            <Button size="sm" variant="outline" disabled={enablePush.isPending || !configReady} onClick={handleEnable}>
              {t(($) => $.notifications.browser.enable)}
            </Button>
          )}
          {permission === "granted" && (
            <span className="shrink-0 text-caption font-medium text-muted-foreground">
              {t(($) => $.notifications.browser.enabled_badge)}
            </span>
          )}
      </SettingsRow>
    </SettingsCard>
  );
}
