"use client";

// The words of /one's shared core, resolved once so every layout says the same thing the
// same way: a reply's `say` key, a chip, a view's name, the "what changed" line and the
// greeting. Layouts call these instead of re-spelling catalog paths.
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Greeting } from "./engine/greeting";
import type { ChangeLine, ChipId, PanelKind, Say } from "./types";

export type OneWords = {
  say: (s: Say) => string;
  chip: (c: ChipId) => string;
  panel: (k: PanelKind) => string;
  change: (c: ChangeLine) => string;
  /** The greeting's status line and its first-need line (null when there is none). */
  greeting: (g: Greeting | { state: "loading" }) => { status: string; first: string | null };
  dropped: (count: number) => string;
};

export function useOneWords(): OneWords {
  const t = useTranslations("one.core");
  return useMemo(() => {
    const panel = (k: PanelKind) => t(`panels.${k}.title`);
    return {
      say: (s: Say) => t(`say.${s.key}`, s.values ?? {}),
      chip: (c: ChipId) => t(`chips.${c}`),
      panel,
      change: (c: ChangeLine) => {
        const main = t(`change.${c.key}`, {
          panel: c.panel ? panel(c.panel) : "",
          previous: c.previous ? panel(c.previous) : "",
        });
        return c.droppedPending ? `${main} ${t("change.droppedSuffix")}` : main;
      },
      greeting: (g: Greeting | { state: "loading" }) => {
        switch (g.state) {
          case "loading":
            return { status: t("greeting.loading"), first: null };
          case "unknown":
            return { status: t("greeting.unknown"), first: null };
          case "clear":
            return { status: t("greeting.clear"), first: null };
          case "needs":
            return { status: t("greeting.status", { areas: g.areas }), first: t(`greeting.first.${g.first.key}`, { count: g.first.count }) };
        }
      },
      dropped: (count: number) => t("dropped", { count }),
    };
  }, [t]);
}
