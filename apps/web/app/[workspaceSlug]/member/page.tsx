"use client";

import { Suspense } from "react";
import { ImSurface } from "@multica/views/im";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImSurface />
    </Suspense>
  );
}
