"use client";

import { Suspense } from "react";
import { ImPage } from "@multica/views/im";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImPage view="contacts" />
    </Suspense>
  );
}
