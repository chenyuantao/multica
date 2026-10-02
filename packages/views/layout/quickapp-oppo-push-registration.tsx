"use client";

import { useQuickAppOppoPushRegistration } from "@multica/core/push";

/** Mount once under the dashboard shell; registers OPPO Quick App push. */
export function QuickAppOppoPushRegistration() {
  useQuickAppOppoPushRegistration();
  return null;
}
