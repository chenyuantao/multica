/** Fence language the thread renders as a cancellation notice. */
const FENCE_LANG = "multica-cancelled";

export interface CancelledNoticeData {
  trigger: string;
  request?: unknown;
  response?: unknown;
}

/**
 * The cancellation notice payload, or null when the content is not that
 * notice. An empty trigger string is still a notice.
 */
export function parseCancelledNotice(content: string): CancelledNoticeData | null {
  const text = content.trim();
  const open = "```" + FENCE_LANG;
  if (!text.startsWith(open)) return null;
  const body = text.slice(open.length).replace(/^\n/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(body) as { trigger?: unknown; request?: unknown; response?: unknown };
    if (typeof parsed.trigger !== "string") return null;
    return {
      trigger: parsed.trigger,
      request: parsed.request,
      response: parsed.response,
    };
  } catch {
    return null;
  }
}

/**
 * The trigger message quoted on a cancellation notice, or null when the
 * content is not that notice.
 */
export function cancelledNoticeTrigger(content: string): string | null {
  return parseCancelledNotice(content)?.trigger ?? null;
}
