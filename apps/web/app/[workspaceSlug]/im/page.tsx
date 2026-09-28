"use client";

import { Suspense } from "react";
import { ImPage } from "@multica/views/im";

// Group chats render full-window, outside the (dashboard) shell.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImPage />
    </Suspense>
  );
}
