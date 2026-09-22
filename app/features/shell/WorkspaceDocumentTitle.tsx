"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { navLabel, type WorkspaceTabId } from "./tabs";
import { useTasks } from "./tasks/TasksProvider";
import { runningTitleProgress } from "./workspaceDocumentTitle";

/** Name the in-shell view even though tab switches do not navigate the route. */
export function WorkspaceDocumentTitle({ active }: { active: WorkspaceTabId }) {
  const t = useTranslations("nav");
  const { running } = useTasks();
  const progress = runningTitleProgress(running);
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    baseTitle.current = document.title;
    return () => {
      if (baseTitle.current != null) document.title = baseTitle.current;
    };
  }, []);

  useEffect(() => {
    if (baseTitle.current == null) return;
    document.title = `${progress ? `(${progress}) ` : ""}${navLabel(t, `tabs.${active}`, active)} | ${baseTitle.current}`;
  }, [active, progress, t]);

  return null;
}
