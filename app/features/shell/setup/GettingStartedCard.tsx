"use client";

import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { PANEL } from "@/app/_components/ui/recipes";
import { useGettingStarted } from "./setupGettingStartedModel";
import { GettingStartedNextMove } from "./SetupGettingStartedNextMove";

// Getting-started checklist — the wizard's hand-off surface, living on the
// Pipeline board (the default tab). Every row is DATA-DERIVED server-side
// (GET /api/me/getting-started): doing the work through any door completes the
// step, so there is no per-step flag to drift. Rows deep-link to the REAL tab
// and "Show me" lights a one-off SimSpotlight coachmark on the exact control
// (sim.coachmark — the guided-tour spotlight reused without running the tour).
// Dismissal is a local, per-browser preference (the repo's convention for
// user-scoped UI state); the card also disappears for good once all four core
// steps are complete.
//
// This file owns only the lifecycle (fetch, dismiss, all-done). The step taxonomy
// and derivations live in ./getting-started-model.ts and the rendered briefing in
// ./GettingStartedNextMove.tsx, which is a pure view over the server payload — so
// no view can invent progress that the API didn't report.

/** All four core steps complete — a single congratulation, shared by every variant. */
function GettingStartedCompleted({ dismiss }: { dismiss: () => void }) {
  const t = useTranslations("setup.checklist");
  return (
    <section aria-label={t("title")} className={`${PANEL} flex items-center gap-3 p-4`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-moss/15 text-moss">
        <Check size={18} aria-hidden />
      </span>
      {/* text-base, not text-sm: this card sits in the Pipeline column between the
          attention strip and the Today rail, both of which read at the page's
          base size — a smaller voice here made the congratulation look like a
          footnote to them. */}
      <div className="min-w-0 flex-1 text-base">
        <p className="font-semibold text-ink">{t("completed.title")}</p>
        <p className="text-steel">{t("completed.body")}</p>
      </div>
      <button type="button" onClick={dismiss} className="focus-ring rounded-full p-1.5 text-steel hover:text-ink" aria-label={t("dismiss")}>
        <X size={16} aria-hidden />
      </button>
    </section>
  );
}

export function GettingStartedCard() {
  const sim = useSimulation();
  const { data, dismissed, dismiss } = useGettingStarted();

  if (dismissed || !data || sim.running) return null;

  if (data.allDone) return <GettingStartedCompleted dismiss={dismiss} />;

  // "Next move": a briefing, not a to-do list — the first unfinished core step is
  // promoted to a full block with one primary action, the rest demoted to a rail.
  // That single-CTA shape is deliberate: the Pipeline empty state directly below
  // carries its own upstream links, and two competing CTA clusters read as noise.
  return <GettingStartedNextMove data={data} dismiss={dismiss} />;
}
