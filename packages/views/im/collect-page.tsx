"use client";

import { Bookmark } from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { messageCollectionListOptions, useDeleteMessageCollection } from "@multica/core/collections";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import type { MessageCollection } from "@multica/core/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@multica/ui/components/ui/context-menu";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { useNavigation } from "../navigation";
import { DragStrip } from "../platform";
import { RichContent } from "../rich-content";
import { collectionListTitle, parseChatHistory, type HistoryLabels } from "./chat-history";
import { ChatHistoryTranscript } from "./chat-history-card";
import { ImRail } from "./im-rail";
import { ImSidebarSearch } from "./im-sidebar-search";
import { ImSidebarHeader, ImSidebarShell } from "./im-sidebar-shell";
import { MeSectionTabs } from "./me-section-tabs";
import { MobileLevel, MobileTabScreen } from "./mobile-shell";

const EMPTY: MessageCollection[] = [];

/**
 * Saved messages. Desktop matches the chat surface: a list on the left and
 * the message on the right. A phone keeps this inside Me, and opens one
 * saved message as its own level.
 */
export function CollectPage() {
  const { t } = useT("im");
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const isMobile = useIsMobile();
  const list = useQuery(messageCollectionListOptions(wsId));
  const remove = useDeleteMessageCollection(wsId);
  const items = useMemo(() => {
    const rows = list.data ?? EMPTY;
    return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }, [list.data]);
  const labels: HistoryLabels = {
    image: t(($) => $.thread.history_image),
    document: t(($) => $.thread.history_document),
    history: t(($) => $.thread.history_record),
  };
  const requestedId = navigation.searchParams.get("item");
  const requested = items.find((item) => item.id === requestedId) ?? null;
  const selected = requested ?? (requestedId || isMobile ? null : items[0] ?? null);

  const select = (id: string) =>
    isMobile ? navigation.push(paths.collectItem(id)) : navigation.replace(paths.collectItem(id));

  const onRemove = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => {
        toast.success(t(($) => $.collect.removed));
        if (navigation.searchParams.get("item") === id) navigation.replace(paths.collect());
      },
      onError: () => toast.error(t(($) => $.collect.remove_failed)),
    });
  };

  const sidebar = (
    <CollectionList
      items={items}
      labels={labels}
      selectedId={selected?.id ?? null}
      isLoading={list.isLoading}
      isError={list.isError}
      iosMenu={isMobile}
      hideHeader={isMobile}
      onSelect={select}
      onRemove={onRemove}
    />
  );

  if (isMobile) {
    if (requestedId && requested) {
      return (
        <MobileLevel title={requested.source_title} backHref={paths.collect()} backLabel={t(($) => $.collect.back)}>
          <CollectionDetail item={requested} />
        </MobileLevel>
      );
    }
    return (
      <MobileTabScreen active="settings">
        <div className="flex min-w-0 flex-1 flex-col">
          <MeSectionTabs active="collect" />
          {sidebar}
        </div>
      </MobileTabScreen>
    );
  }

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <ImRail active="collect" />
      {sidebar}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="relative flex h-14 shrink-0 items-center border-b px-5">
              <div className="absolute inset-0">
                <DragStrip />
              </div>
              <h1 className="relative min-w-0 truncate text-body-lg font-semibold">{selected.source_title}</h1>
            </header>
            <CollectionDetail item={selected} />
          </>
        ) : (
          <>
            <DragStrip />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Bookmark className="size-8" />
              <p className="text-body">{list.isLoading ? "" : t(($) => $.collect.select)}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CollectionList({
  items,
  labels,
  selectedId,
  isLoading,
  isError,
  iosMenu,
  hideHeader,
  onSelect,
  onRemove,
}: {
  items: MessageCollection[];
  labels: HistoryLabels;
  selectedId: string | null;
  isLoading: boolean;
  isError: boolean;
  iosMenu?: boolean;
  hideHeader?: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useT("im");
  return (
    <ImSidebarShell className={hideHeader ? "w-auto min-w-0 flex-1 border-r-0" : undefined}>
      {!hideHeader && (
        <ImSidebarHeader
          title={t(($) => $.rail.collect)}
          desktopSearch={<ImSidebarSearch priority="favorites" onOpenFavorite={onSelect} />}
        />
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto" aria-label={t(($) => $.rail.collect)}>
        {isError ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.collect.load_failed)}</p>
        ) : !isLoading && items.length === 0 ? (
          <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.collect.empty)}</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => {
              const title = collectionListTitle(item.content, labels) || t(($) => $.collect.untitled);
              const selected = item.id === selectedId;
              return (
                <li key={item.id} className="border-b border-foreground/5 last:border-b-0">
                  <ContextMenu>
                    <ContextMenuTrigger className="block [-webkit-touch-callout:none] data-[popup-open]:bg-foreground/5">
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                          selected ? "bg-brand/12 hover:bg-brand/12" : "hover:bg-foreground/5",
                        )}
                      >
                        <span className="truncate text-body font-medium" title={title}>
                          {title}
                        </span>
                        <span className="flex min-w-0 items-baseline gap-3 text-caption text-muted-foreground">
                          <span className="min-w-0 flex-1 truncate">{item.source_title}</span>
                          <span className="max-w-[40%] shrink-0 truncate text-right">{item.sender_name}</span>
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent
                      className={cn(iosMenu && "min-w-56 rounded-[14px] bg-surface-raised/85 p-0 backdrop-blur-xl")}
                    >
                      <ContextMenuItem
                        onClick={() => onRemove(item.id)}
                        className={cn(iosMenu && "h-11 justify-between rounded-none px-4 text-body-lg")}
                      >
                        {t(($) => $.collect.remove)}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </ImSidebarShell>
  );
}

/** One saved message. A chat-history snapshot is expanded into its messages. */
function CollectionDetail({ item }: { item: MessageCollection }) {
  const record = parseChatHistory(item.content);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {record ? (
          <ChatHistoryTranscript record={record} />
        ) : (
          <div className="mb-5 flex items-start">
            <div className="grid min-w-0 max-w-[min(78%,660px)] gap-1">
              <span className="mb-0.5 ml-0.5 text-micro text-muted-foreground">{item.sender_name}</span>
              <div className="relative max-w-full min-w-0 rounded-[6px] bg-im-bubble-other px-3 py-[7px] text-body break-words text-im-bubble-other-foreground">
                <RichContent content={item.content} density="compact" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
