"use client";

import { imSurfaceSegment } from "@multica/core/paths";
import { ModalRegistry } from "../modals/registry";
import { useNavigation } from "../navigation";
import { CollectPage } from "./collect-page";
import { ImPage } from "./im-page";
import { KnowledgePage } from "./knowledge-page";
import { ReminderPage } from "./reminder-page";

/**
 * One mounted tree for chats, contacts, knowledge, reminders, and favorites. The web
 * adapter swaps the URL with history.pushState; this component follows
 * pathname so the tab change does not wait for a new RSC payload.
 */
export function ImSurface() {
  const { pathname } = useNavigation();
  const segment = imSurfaceSegment(pathname);
  return (
    <>
      {segment === "knowledge" ? (
        <KnowledgePage />
      ) : segment === "reminder" ? (
        <ReminderPage />
      ) : segment === "collect" ? (
        <CollectPage />
      ) : (
        <ImPage view={segment === "member" ? "contacts" : "chats"} />
      )}
      <ModalRegistry />
    </>
  );
}
