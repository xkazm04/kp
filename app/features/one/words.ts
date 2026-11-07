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
  /** The module's name ("Pipeline") — the index / generic word. */
  panel: (k: PanelKind) => string;
  /** A view's TITLE as its panel resolves it from kind + params ("Stalled candidates",
   *  "Pipeline · backend") — what tabs, the change line and pins call a view. */
  view: (k: PanelKind, params?: Record<string, string>) => string;
  change: (c: ChangeLine) => string;
  /** The greeting's status line and its first-need line (null when there is none). */
  greeting: (g: Greeting | { state: "loading" }) => { status: string; first: string | null };
  dropped: (count: number) => string;
};

export function useOneWords(): OneWords {
  const t = useTranslations("one.core");
  return useMemo(() => {
    const panel = (k: PanelKind) => t(`panels.${k}.title`);
    // The typed translator does not take a computed key; the keys viewTitle builds are
    // fixed (panels.<kind>.title, the two filter titles, panels.withRole).
    const view = (k: PanelKind, params: Record<string, string> = {}) => viewTitle(k, params, t as unknown as Tr);
    return {
      say: (s: Say) => t(`say.${s.key}`, s.values ?? {}),
      chip: (c: ChipId) => t(`chips.${c}`),
      panel,
      view,
      change: (c: ChangeLine) => {
        const main = t(`change.${c.key}`, {
          panel: c.panel ? view(c.panel, c.params) : "",
          previous: c.previous ? view(c.previous, c.previousParams) : "",
          answer: c.answer ?? 0,
          of: c.of ?? 0,
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

/** The one rule for a view's title from kind + params — the same words the panel puts in
 *  its own head (PipelineSlicePanel's filter titles), so a tab never says "Pipeline" over
 *  a table titled "Stalled candidates". A role the user named rides after the title. */
type Tr = (key: string, values?: Record<string, string>) => string;

export function viewTitle(k: PanelKind, params: Record<string, string>, t: Tr): string {
  const base =
    k === "pipelineSlice" && params.filter === "aging"
      ? t("panels.pipelineSlice.titleAging")
      : k === "pipelineSlice" && params.filter === "new"
        ? t("panels.pipelineSlice.titleNew")
        : t(`panels.${k}.title`);
  return params.role ? t("panels.withRole", { title: base, role: params.role }) : base;
}
