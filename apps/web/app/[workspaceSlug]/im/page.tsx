"use client";

import { Suspense } from "react";
import { ImPage } from "@multica/views/im";
import { ModalRegistry } from "@multica/views/modals/registry";

// Group chats render full-window, outside the (dashboard) shell, so they
// mount their own ModalRegistry.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImPage />
      <ModalRegistry />
    </Suspense>
  );
}
