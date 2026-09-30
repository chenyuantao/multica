"use client";

import { Suspense } from "react";
import { KnowledgePage } from "@multica/views/im";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <KnowledgePage />
    </Suspense>
  );
}
