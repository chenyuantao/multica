"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { DragStrip } from "../platform";
import { MobileLevel } from "./im-page";
import { ImRail } from "./im-rail";
import { KnowledgeDocument } from "./knowledge-document";
import { KnowledgeSidebar } from "./knowledge-sidebar";
import { noteTitle } from "./knowledge-utils";
import { NewNoteDialog } from "./new-note-dialog";

/**
 * Obsidian vault browser in the IM surface (`/knowledge`). The open note is
 * route-driven (`?file=`), so links and mobile back navigation address it.
 */
export function KnowledgePage() {
  const { t } = useT("im");
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const selectedPath = navigation.searchParams.get("file") || null;
  const [createDir, setCreateDir] = useState<string | null>(null);

  const select = (path: string) =>
    isMobile ? navigation.push(paths.knowledgeFile(path)) : navigation.replace(paths.knowledgeFile(path));

  const dialog = (
    <NewNoteDialog
      dir={createDir}
      onOpenChange={(open) => {
        if (!open) setCreateDir(null);
      }}
      onCreated={(file) => select(file.path)}
    />
  );

  if (isMobile) {
    return (
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        {selectedPath ? (
          <MobileLevel
            title={noteTitle(selectedPath.split("/").pop() ?? "")}
            backHref={paths.knowledge()}
            backLabel={t(($) => $.knowledge.back)}
          >
            <KnowledgeDocument key={selectedPath} path={selectedPath} variant="page" />
          </MobileLevel>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ImRail active="knowledge" />
            <KnowledgeSidebar
              selectedPath={null}
              onSelect={select}
              onCreate={setCreateDir}
              className="w-auto min-w-0 flex-1 border-r-0"
            />
          </div>
        )}
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <ImRail active="knowledge" />
      <KnowledgeSidebar selectedPath={selectedPath} onSelect={select} onCreate={setCreateDir} />
      <div className="relative flex min-w-0 flex-1">
        {selectedPath ? (
          <KnowledgeDocument key={selectedPath} path={selectedPath} />
        ) : (
          <div className="flex flex-1 flex-col">
            <DragStrip />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <BookOpen className="size-8" />
              <p className="text-body">{t(($) => $.knowledge.select)}</p>
            </div>
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
