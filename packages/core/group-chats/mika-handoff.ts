let pendingAskCommentId: string | null = null;

/** Remember the message just sent to Mika, so a later group event can open it. */
export function expectMikaTaskChat(commentId: string): void {
  pendingAskCommentId = commentId || null;
}

/**
 * Returns true once, when this event is the group Mika started for the
 * message we are waiting on.
 */
export function takeMikaTaskChat(askCommentId: string | undefined | null): boolean {
  if (!askCommentId || pendingAskCommentId !== askCommentId) return false;
  pendingAskCommentId = null;
  return true;
}
