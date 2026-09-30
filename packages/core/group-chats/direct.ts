import type { GroupChat, GroupChatMember, GroupChatMemberRef } from "../types";

function isSelf(m: GroupChatMember, userId: string): boolean {
  return m.member_type === "member" && m.member_id === userId;
}

/**
 * The other side of a direct chat the user is in, or null for a group. A
 * direct chat is presented as a conversation with that person or agent.
 */
export function directChatPeer(chat: GroupChat, userId: string): GroupChatMember | null {
  if (!chat.is_direct || !chat.members.some((m) => isSelf(m, userId))) return null;
  return chat.members.find((m) => !isSelf(m, userId)) ?? null;
}

/** The user's direct chat with `peer`, oldest first when several exist. */
export function findDirectChat(chats: readonly GroupChat[], userId: string, peer: GroupChatMemberRef): GroupChat | null {
  let found: GroupChat | null = null;
  for (const chat of chats) {
    const other = directChatPeer(chat, userId);
    if (other?.member_type !== peer.member_type || other.member_id !== peer.member_id) continue;
    if (!found || chat.created_at < found.created_at) found = chat;
  }
  return found;
}
