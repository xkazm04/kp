"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { toast } from "@/app/_components/toast-store";
import { useGettingStarted, CHECKLIST_HIGHLIGHT_KEY, STEPS, stepDone } from "./setupGettingStartedModel";
import { GettingStartedNextMove } from "./SetupGettingStartedNextMove";

// Getting-started checklist — the wizard's hand-off surface, living on the
// Pipeline board (the default tab). Every row is DATA-DERIVED server-side
// (GET /api/me/getting-started): doing the work through any door completes the
// step, so there is no per-step flag to drift. Rows deep-link to the REAL tab.
// Dismissal is a local, per-browser preference (the repo's convention for
// user-scoped UI state); the card also disappears for good once all four
// steps are complete.
//
// This file owns only the lifecycle (fetch, dismiss, all-done). The step taxonomy
// and derivations live in ./setupGettingStartedModel.ts and the rendered briefing
// in ./SetupGettingStartedNextMove.tsx, which is a pure view over the server
// payload — so no view can invent progress that the API didn't report.

export function GettingStartedCard() {
  const t = useTranslations("setup.checklist");
  const sim = useSimulation();
  const { data, dismissed, dismiss, undismiss } = useGettingStarted();

  const handleDismiss = useCallback(() => {
    dismiss();
    toast.info(t("dismissedToast"), {
      duration: 5000,
      action: { label: t("dismissedUndo"), onAction: undismiss },
    });
  }, [dismiss, undismiss, t]);
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Track which steps were done on the previous render to detect transitions.
  // Initialised as null so the first-mount effect skips (no prior state to compare).
  const prevDoneRef = useRef<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (!data) return;
    const current: Record<string, boolean> = {};
    for (const step of STEPS) current[step.key] = stepDone(step.key, data);
    const prev = prevDoneRef.current;
    if (prev !== null) {
      for (const step of STEPS) {
        if (!prev[step.key] && current[step.key]) {
          setAnnouncement(t("stepComplete", { step: t(`steps.${step.key}.title`) }));
          break;
        }
      }
    }
    prevDoneRef.current = current;
  }, [data, t]);

  // When the wizard hand-off card was clicked, scroll the checklist into view and
  // apply a brief attention ring so the operator sees exactly what they were told
  // about, without having to search for it.
  useEffect(() => {
    if (dismissed || !data) return;
    let flag = false;
    try { flag = window.sessionStorage.getItem(CHECKLIST_HIGHLIGHT_KEY) === "1"; } catch { /* per-browser storage only */ }
    if (!flag) return;
    try { window.sessionStorage.removeItem(CHECKLIST_HIGHLIGHT_KEY); } catch { /* per-browser storage only */ }
    // Wait one frame so the card is fully mounted before scrolling.
    let raf = 0;
    let tid = 0;
    raf = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setHighlighted(true);
      tid = window.setTimeout(() => setHighlighted(false), 2000);
    });
    return () => { cancelAnimationFrame(raf); window.clearTimeout(tid); };
  }, [dismissed, data]);

  if (dismissed || !data || sim.running) return null;

  // All four steps done: the surface retires itself. An operator who has set up a
  // company, built a role, designed a case and wired an intake has done
  // everything this card teaches, so a congratulation card in the Pipeline
  // column would just be furniture standing where their work should be.
  if (data.allDone) return null;

  // "Next move": a briefing, not a to-do list — the first unfinished core step is
  // promoted to a full block with one primary action, the rest demoted to a rail.
  // That single-CTA shape is deliberate: the Pipeline empty state directly below
  // carries its own upstream links, and two competing CTA clusters read as noise.
  return (
    <div
      ref={ref}
      className={highlighted ? "rounded-xl ring-2 ring-moss ring-offset-2 transition-all duration-500" : ""}
    >
      {/* Stable live region: only populated on step-completion transitions, not every
          poll tick. Visually hidden so it doesn't alter layout. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      <GettingStartedNextMove data={data} dismiss={handleDismiss} />
    </div>
  );
}
