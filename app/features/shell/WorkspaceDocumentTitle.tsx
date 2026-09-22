"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { navLabel, type WorkspaceTabId } from "./tabs";

/** Name the in-shell view even though tab switches do not navigate the route. */
export function WorkspaceDocumentTitle({ active }: { active: WorkspaceTabId }) {
  const t = useTranslations("nav");
  const baseTitle = useRef<string | null>(null);

  useEffect(() => {
    baseTitle.current = document.title;
    return () => {
      if (baseTitle.current != null) document.title = baseTitle.current;
    };
  }, []);

  useEffect(() => {
    if (baseTitle.current == null) return;
    document.title = `${navLabel(t, `tabs.${active}`, active)} | ${baseTitle.current}`;
  }, [active, t]);

  return null;
}
