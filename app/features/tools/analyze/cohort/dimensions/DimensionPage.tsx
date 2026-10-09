"use client";

// The shared dimension page (spark analyze-v2-cohort WP4): every world (WP5-7) descends into
// THIS component and must not fork it. A dispatcher over seven pages, each a different picture
// of the cohort on ONE axis, under one shared claim strip. The export name and DimensionPageProps
// are the contract (cohortTypes.ts).
import { useEffect, useRef, type ComponentType, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { CohortDimension, DimensionPageProps } from "../cohortTypes";
import { stepMember } from "./dimensionModel";
import type { PageProps } from "./dimensionParts";
import { DimensionClaim } from "./DimensionClaim";
import { DimensionTips } from "./DimensionTips";
import { FitPage } from "./FitPage";
import { SkillsPage } from "./SkillsPage";
import { ExperiencePage } from "./ExperiencePage";
import { SignalsPage } from "./SignalsPage";
import { TrustPage } from "./TrustPage";
import { SalaryPage } from "./SalaryPage";
import { PublicWorkPage } from "./PublicWorkPage";
import "./dimensions.css";

const PAGES: Record<CohortDimension, ComponentType<PageProps>> = {
  fit: FitPage,
  skills: SkillsPage,
  experience: ExperiencePage,
  signals: SignalsPage,
  trust: TrustPage,
  salary: SalaryPage,
  publicWork: PublicWorkPage,
};

/** The workspace's chord window: a key within it after a bare `g` belongs to the `g` chord. */
const CHORD_WINDOW_MS = 1500;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

const stopSelector = (id: string) => `[data-dim-stop][data-dim-member="${CSS.escape(id)}"]`;

export function DimensionPage({ view, dimension, focusMemberId, onFocusMember, onOpenReport }: DimensionPageProps) {
  const t = useTranslations("analyzeCohort");
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const lastG = useRef(0);

  // A member focused AFTER mount (pressed, or reached by j/k) is scrolled into view inside
  // whatever scrolls: the grid's own overflow, then the page. The first render never scrolls:
  // the world owns the initial positioning, and a scroll on mount would yank the viewport in the
  // middle of its descent animation (Director's contract change, from the Loom builder).
  const prevFocus = useRef(focusMemberId);
  useEffect(() => {
    if (prevFocus.current === focusMemberId) return;
    prevFocus.current = focusMemberId;
    if (!focusMemberId) return;
    const el = root.current?.querySelector<HTMLElement>(stopSelector(focusMemberId));
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [focusMemberId, reduced]);

  // j/k and the up/down arrows walk the members INSIDE the page body (focus must be in it, so a
  // world's own keys outside stay its own; left/right and [ ] are the world's sideways step).
  // Yields like the Night Post's level keys: a modifier, a field, a key already handled, the
  // second key of a workspace `g` chord.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
    if (e.key.toLowerCase() === "g" && !e.shiftKey) {
      lastG.current = Date.now();
      return;
    }
    const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    if (lastG.current && Date.now() - lastG.current < CHORD_WINDOW_MS) {
      lastG.current = 0;
      return;
    }
    const stops = [...(root.current?.querySelectorAll<HTMLElement>("[data-dim-stop]") ?? [])];
    const ids = stops.map((el) => el.dataset.dimMember ?? "");
    const here = e.target instanceof Element ? (e.target.closest("[data-dim-member]") as HTMLElement | null)?.dataset.dimMember : undefined;
    const next = stepMember(ids, here ?? focusMemberId, delta);
    if (!next) return;
    e.preventDefault();
    stops[ids.indexOf(next)]?.focus();
    onFocusMember(next);
  };

  const Page = PAGES[dimension];
  return (
    <div
      ref={root}
      className="cd-dim k-kit"
      data-cohort-dimension={dimension}
      role="region"
      aria-label={t("pages.common.region", { dimension: t(`dims.${dimension}`) })}
      onKeyDown={onKeyDown}
    >
      <DimensionClaim view={view} dimension={dimension} />
      <Page view={view} focusMemberId={focusMemberId} onFocusMember={onFocusMember} onOpenReport={onOpenReport} />
      <DimensionTips root={root} />
    </div>
  );
}
