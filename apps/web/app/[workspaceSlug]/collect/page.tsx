"use client";

import { Suspense } from "react";
import { CollectPage } from "@multica/views/im";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CollectPage />
    </Suspense>
  );
}
