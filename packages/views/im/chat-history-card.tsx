"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { RichContent } from "../rich-content";
import {
  historyAuthorNames,
  historyPreviewLines,
  parseChatHistory,
  type ChatHistoryRecord,
  type HistoryLabels,
} from "./chat-history";
import { formatStamp } from "./im-utils";

export function useHistoryTitle(record: ChatHistoryRecord | null): string {
  const { t } = useT("im");
  const names = historyAuthorNames(record?.messages ?? []);
  const first = names[0] ?? "";
  const second = names[1];
  if (!second) return t(($) => $.thread.history_title_single, { name: first });
  if (names.length === 2) return t(($) => $.thread.history_title_pair, { first, second });
  return t(($) => $.thread.history_title_rest, { first });
}

/** The messages inside one card. A nested card opens another page when `onOpenNested` is set. */
export function ChatHistoryTranscript({
  record,
  onOpenNested,
}: {
  record: ChatHistoryRecord;
  onOpenNested?: (index: number) => void;
}) {
  const { t } = useT("im");
  return (
    <ol className="flex flex-col gap-4">
      {record.messages.map((message, index) => (
        <li key={index} className="min-w-0">
          <p className="mb-1 flex items-baseline gap-2 text-caption text-muted-foreground">
            <span className="truncate font-medium text-foreground">{message.author_name}</span>
            <span className="shrink-0 tabular-nums">
              {formatStamp(message.created_at, new Date(), (time) => t(($) => $.thread.yesterday, { time }), {
                withTime: true,
              })}
            </span>
          </p>
          {parseChatHistory(message.content) ? (
            <ChatHistoryCard
              content={message.content}
              onOpen={onOpenNested ? () => onOpenNested(index) : undefined}
            />
          ) : (
            <RichContent content={message.content} density="compact" />
          )}
        </li>
      ))}
    </ol>
  );
}

/** Collapsed chat-history card. Desktop opens a dialog; a phone passes `onOpen` and uses a page. */
export function ChatHistoryCard({
  content,
  interactive = true,
  onOpen,
}: {
  content: string;
  interactive?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useT("im");
  const record = parseChatHistory(content);
  const title = useHistoryTitle(record);
  const [open, setOpen] = useState(false);
  if (!record) return null;

  const labels: HistoryLabels = {
    image: t(($) => $.thread.history_image),
    document: t(($) => $.thread.history_document),
    history: t(($) => $.thread.history_record),
  };
  const lines = historyPreviewLines(record.messages, labels, 12);
  const footer = t(($) => $.thread.history_footer);
  const preview = lines.map((line) => t(($) => $.thread.quote_line, { name: line.name, text: line.text })).join("\n");
  const card = (
    <>
      <span className="block shrink-0 truncate text-body font-medium text-foreground">{title}</span>
      {preview && (
        <span className="mt-1 line-clamp-5 min-h-0 text-caption break-all whitespace-pre-line text-muted-foreground">{preview}</span>
      )}
      <span className="mt-auto block shrink-0 pt-1.5 text-caption text-foreground/80">{footer}</span>
    </>
  );
  const frame =
    "box-border flex h-[156px] w-[256px] shrink-0 flex-col overflow-hidden rounded-md bg-muted px-3 py-2.5 text-left";

  return (
    <>
      {interactive ? (
        <button
          type="button"
          onClick={() => (onOpen ? onOpen() : setOpen(true))}
          className={cn(frame, "hover:bg-muted/80")}
        >
          {card}
        </button>
      ) : (
        <div className={frame}>{card}</div>
      )}
      {interactive && !onOpen && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ChatHistoryTranscript record={record} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
