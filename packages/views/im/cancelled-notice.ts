/** Fence language the thread renders as a cancellation notice. */
const FENCE_LANG = "multica-cancelled";

/**
 * The trigger message quoted on a cancellation notice, or null when the
 * content is not that notice. An empty string is a notice with no trigger.
 */
export function cancelledNoticeTrigger(content: string): string | null {
  const text = content.trim();
  const open = "```" + FENCE_LANG;
  if (!text.startsWith(open)) return null;
  const body = text.slice(open.length).replace(/^\n/, "").replace(/\n?```$/, "");
  try {
    const parsed = JSON.parse(body) as { trigger?: unknown };
    return typeof parsed.trigger === "string" ? parsed.trigger : null;
  } catch {
    return null;
  }
}
