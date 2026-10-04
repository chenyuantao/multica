"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Loader2, Mic, X } from "lucide-react";
import { ApiError } from "@multica/core/api";
import { docFileOptions, docsKeys } from "@multica/core/docs";
import { useAskAI, useSendGroupChatMessage } from "@multica/core/group-chats";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import type { DocFile } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { toast } from "sonner";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { noteAskPage } from "./ask-ai-context";
import { noteTitle } from "./knowledge-utils";
import { useVoiceHold } from "./voice-hold";

interface DocumentVoiceAskProps {
  path: string;
  /** Title of the note, when the caller already has one. */
  name?: string;
  /**
   * Group chat this note was opened from. Spoken text is sent there.
   * Without it, the text starts an Ask AI chat about the note.
   */
  chatId?: string;
  /** After a group message is sent, so the phone can show that chat. */
  onSent?: () => void;
}

function spokenText(value: string): string {
  return value.replaceAll("\u0000", "").trim();
}

/**
 * Hold-to-talk bar for a phone document. Releasing sends the transcript:
 * into the group chat the note was opened from, or into a new Ask AI chat.
 * Either way the open note goes with the message.
 */
export function DocumentVoiceAsk({ path, name, chatId, onSent }: DocumentVoiceAskProps) {
  const { t } = useT("im");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const fileQuery = useQuery(docFileOptions(path));
  const ask = useAskAI(wsId);
  const send = useSendGroupChatMessage(wsId, chatId ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const busyRef = useRef(false);
  const pending = ask.isPending || send.isPending;

  const pageFor = () => noteAskPage(path, qc.getQueryData<DocFile>(docsKeys.file(path)) ?? fileQuery.data);

  const fail = (err: unknown) => {
    if (!chatId) {
      const noAgent = err instanceof ApiError && (err.body as { code?: string } | undefined)?.code === "ask_ai_no_agent";
      toast.error(noAgent ? t(($) => $.search.ask_no_agent) : t(($) => $.search.ask_failed));
      return;
    }
    toast.error(t(($) => $.knowledge.voice_failed));
  };

  const submit = (value: string) => {
    const text = spokenText(value);
    if (!text || pending || busyRef.current) return;
    busyRef.current = true;
    const page = pageFor();
    const done = () => {
      busyRef.current = false;
    };
    if (chatId) {
      const label = name?.trim() || noteTitle(path.split("/").pop() ?? path);
      void send
        .mutateAsync({ content: text, focusNote: { name: label, path }, page })
        .then(() => {
          setDraft(null);
          onSent?.();
        })
        .catch(fail)
        .finally(done);
      return;
    }
    ask.mutate(
      { query: text, page },
      {
        onSuccess: ({ chat }) => {
          setDraft(null);
          navigation.push(paths.imChat(chat.id));
        },
        onError: fail,
        onSettled: done,
      },
    );
  };

  const voice = useVoiceHold({
    enabled: draft === null && !pending,
    onSend: submit,
    onEdit: (spoken) => {
      const text = spokenText(spoken);
      if (text) setDraft(text);
    },
  });

  const label = pending ? t(($) => $.knowledge.voice_sending) : t(($) => $.composer.voice_hold);

  return (
    <div className="shrink-0 border-t bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {draft === null ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full rounded-full touch-none"
          style={{ WebkitTouchCallout: "none" }}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={label}
          onPointerDown={voice.onPointerDown}
          onTouchStart={voice.onTouchStart}
          onPointerMove={voice.onPointerMove}
          onPointerUp={voice.onPointerUp}
          onPointerCancel={voice.onPointerCancel}
          onContextMenu={voice.onContextMenu}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Mic />}
          {label}
        </Button>
      ) : (
        <div className="flex items-end gap-2 rounded-3xl border bg-background px-2 py-1.5">
          <textarea
            aria-label={t(($) => $.composer.voice_edit)}
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body outline-none"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 rounded-full"
            onClick={() => setDraft(null)}
            aria-label={t(($) => $.composer.voice_cancel)}
          >
            <X />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            className="shrink-0 rounded-full"
            disabled={pending || !spokenText(draft)}
            aria-busy={pending || undefined}
            aria-label={t(($) => $.composer.send)}
            onClick={() => submit(draft)}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      )}
      {voice.overlay}
    </div>
  );
}
