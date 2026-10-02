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
  type HistoryLabels,
} from "./chat-history";
import { formatStamp } from "./im-utils";

/** Collapsed chat-history card. Clicking it opens the original messages. */
export function ChatHistoryCard({ content, interactive = true }: { content: string; interactive?: boolean }) {
  const { t } = useT("im");
  const record = parseChatHistory(content);
  const [open, setOpen] = useState(false);
  if (!record) return null;

  const labels: HistoryLabels = {
    image: t(($) => $.thread.history_image),
    document: t(($) => $.thread.history_document),
    history: t(($) => $.thread.history_record),
  };
  const names = historyAuthorNames(record.messages);
  const first = names[0] ?? "";
  const second = names[1];
  const title = !second
    ? t(($) => $.thread.history_title_single, { name: first })
    : names.length === 2
      ? t(($) => $.thread.history_title_pair, { first, second })
      : t(($) => $.thread.history_title_rest, { first });
  const lines = historyPreviewLines(record.messages, labels);
  const footer = t(($) => $.thread.history_footer);
  const card = (
    <>
      <span className="block truncate text-body font-medium text-foreground">{title}</span>
      {lines.length > 0 && (
        <span className="mt-1 block space-y-0.5">
          {lines.map((line, index) => (
            <span key={index} className="line-clamp-2 block text-caption text-muted-foreground">
              {t(($) => $.thread.quote_line, { name: line.name, text: line.text })}
            </span>
          ))}
        </span>
      )}
      <span className="mt-2 block text-caption text-foreground/80">{footer}</span>
    </>
  );
  const frame = "block w-64 max-w-full rounded-md bg-muted px-3 py-2.5 text-left";

  return (
    <>
      {interactive ? (
        <button type="button" onClick={() => setOpen(true)} className={cn(frame, "hover:bg-muted/80")}>
          {card}
        </button>
      ) : (
        <div className={frame}>{card}</div>
      )}
      {interactive && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <ol className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
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
                    <ChatHistoryCard content={message.content} />
                  ) : (
                    <RichContent content={message.content} density="compact" />
                  )}
                </li>
              ))}
            </ol>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
