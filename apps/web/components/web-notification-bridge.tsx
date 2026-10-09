"use client";

import { useEffect, useRef } from "react";
import {
  registerSystemNotificationClickHandler,
  type SystemNotificationPayload,
} from "@multica/core/platform";
import { paths } from "@multica/core/paths";
import { useNavigation } from "@multica/views/navigation";

/**
 * Routes a page-shown browser notification click. The web counterpart of the
 * desktop `DesktopInboxBridge`. A service-worker banner is opened by `sw.js`
 * from the same `url`; this handler covers the page Notification fallback.
 *
 * `url` is built from the SOURCE workspace (#3766). Chat messages open that
 * conversation; other rows open the inbox focused on the item. An empty url
 * (unresolved source) is ignored. Marking an inbox row read is handled by
 * InboxPage's selected-item effect, which covers the `?issue=` path.
 */
export function WebNotificationBridge() {
  const { push } = useNavigation();
  // The adapter identity changes with the current route; the ref keeps the
  // registered click handler stable while always calling the latest push.
  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  useEffect(() => {
    registerSystemNotificationClickHandler(
      ({ slug, issueKey, url }: SystemNotificationPayload) => {
        if (url) {
          pushRef.current(url);
          return;
        }
        if (!slug) return;
        const inboxPath = `${paths.workspace(slug).inbox()}?issue=${encodeURIComponent(issueKey)}`;
        pushRef.current(inboxPath);
      },
    );
    return () => registerSystemNotificationClickHandler(null);
  }, []);

  return null;
}
