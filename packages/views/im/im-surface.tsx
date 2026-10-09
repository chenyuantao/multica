"use client";

import { imSurfaceSegment } from "@multica/core/paths";
import { ModalRegistry } from "../modals/registry";
import { useState } from "react";
import { useNavigation } from "../navigation";
import { CollectPage } from "./collect-page";
import { ImPage } from "./im-page";
import { KnowledgePage } from "./knowledge-page";
import { ReminderPage } from "./reminder-page";

/**
 * One mounted tree for chats, contacts, knowledge, reminders, and favorites. The web
 * adapter swaps the URL with history.pushState; this component follows
 * pathname so the tab change does not wait for a new RSC payload.
 * The reminder page stays mounted after the first visit so its open
 * conversation and scroll position survive a section change.
 */
export function ImSurface() {
  const { pathname } = useNavigation();
  const segment = imSurfaceSegment(pathname);
  const [reminderHeld, setReminderHeld] = useState(segment === "reminder");
  if (segment === "reminder" && !reminderHeld) setReminderHeld(true);
  const reminderVisible = segment === "reminder";
  return (
    <>
      {segment === "knowledge" ? (
        <KnowledgePage />
      ) : segment === "collect" ? (
        <CollectPage />
      ) : segment !== "reminder" ? (
        <ImPage view={segment === "member" ? "contacts" : "chats"} />
      ) : null}
      {reminderHeld ? (
        <div className={reminderVisible ? "contents" : undefined} hidden={!reminderVisible} inert={!reminderVisible}>
          <ReminderPage active={reminderVisible} />
        </div>
      ) : null}
      <ModalRegistry />
    </>
  );
}
