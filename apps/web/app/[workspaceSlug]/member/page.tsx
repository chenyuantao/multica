"use client";

import { Suspense } from "react";
import { ImPage } from "@multica/views/im";
import { ModalRegistry } from "@multica/views/modals/registry";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImPage view="contacts" />
      <ModalRegistry />
    </Suspense>
  );
}
