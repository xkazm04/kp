"use client";

// The narrow fallback for EVERY world (below COHORT_NARROW_PX): one card per member, by fit
// rank with the unrated last (orderCards), each card the member's seven short labels with the
// absent ones saying why. A dimension press opens the shared DimensionPage in a plain stacked
// view; Back (or Esc) returns to the card it was opened from.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { BTN_GHOST } from "@/app/_components/ui/recipes";
import type { CohortDimension, CohortWorldProps } from "./cohortTypes";
import { DimensionPage } from "./dimensions/DimensionPage";
import { orderCards } from "./cohortShell";
import { CohortMemberCard } from "./CohortMemberCard";

type Focus = { dimension: CohortDimension; memberId: string | null; opener: string };

export function CohortCardList({ view, onOpenReport }: CohortWorldProps) {
  const t = useTranslations("analyzeCohort.shell.cards");
  const td = useTranslations("analyzeCohort.dims");
  const [focus, setFocus] = useState<Focus | null>(null);
  const cards = useMemo(() => orderCards(view.members), [view.members]);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastOpener = useRef<string | null>(null);

  // Focus follows the move: the page heading on the way in, the opener on the way back.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (focus) root.querySelector<HTMLElement>("[data-card-page-heading]")?.focus();
    else if (lastOpener.current) root.querySelector<HTMLElement>(`[data-card-opener="${CSS.escape(lastOpener.current)}"]`)?.focus();
  }, [focus]);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      // Yield to an open dialog and to a field the reader is typing in.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog][aria-modal=true]")) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const open = (dimension: CohortDimension, memberId: string) => {
    const opener = `${memberId}:${dimension}`;
    lastOpener.current = opener;
    setFocus({ dimension, memberId, opener });
  };

  return (
    <div ref={rootRef} data-cohort-cards={view.members.length}>
      <p role="status" className="sr-only">
        {focus ? t("trail", { dimension: td(focus.dimension) }) : t("trailRoot")}
      </p>
      {focus ? (
        <div className="space-y-4">
          <button type="button" onClick={() => setFocus(null)} className={`${BTN_GHOST} h-9 px-2 text-body`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("back")}
          </button>
          <h3 tabIndex={-1} data-card-page-heading className="font-serif text-h2 text-ink outline-none">
            {td(focus.dimension)}
          </h3>
          <DimensionPage
            view={view}
            dimension={focus.dimension}
            focusMemberId={focus.memberId}
            onFocusMember={(memberId) => setFocus({ ...focus, memberId })}
            onOpenReport={onOpenReport}
          />
        </div>
      ) : (
        <ol className="space-y-3" aria-label={t("label", { n: cards.length })}>
          {cards.map((m) => (
            <li key={m.memberId}>
              <CohortMemberCard member={m} view={view} onOpenDimension={open} onOpenReport={onOpenReport} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
