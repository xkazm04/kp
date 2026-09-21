"use client";

/*
 * The plan rail — labels, not dots, because a dot cannot say "Capability keys".
 *
 * The list is the plan when the agent declared one and the fixed fallback
 * otherwise, and both are the same {id,label} shape, so there is exactly one
 * renderer: a plan-less session is a different LIST, not a special case.
 *
 * The active step rides a shared-layout pill (`layoutId`) that slides between
 * rows as the phase stream advances — the segmented-control motion standard,
 * applied to a vertical rail. Under `prefers-reduced-motion` it snaps.
 */

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { EYEBROW } from "@/app/_components/ui/recipes";
import { FALLBACK_PHASES, type PlanStep } from "./protocol";
import { COPY, FALLBACK_PHASE_LABEL } from "./copy";
import type { SessionState } from "./useWizardSession";

type RailStep = PlanStep & { pending?: boolean };

/**
 * Recon-first means the rail must not promise a pipeline before one has been
 * decided. While `assess` is the live phase and no plan has arrived, the honest
 * rail is "I am looking, and a plan follows" — showing the full fixed list there
 * is exactly the "it just walked Full setup" complaint the recon flow exists to
 * answer. The fixed list is for the runs that move PAST assess without ever
 * declaring a plan.
 */
export function railSteps(state: SessionState): RailStep[] {
  if (state.plan?.length) return state.plan;
  // Before the host has said hello there is no session, and the fallback list is
  // a PROMISE about one. Showing eight confident steps for a run that may not
  // exist is the same lie the recon-first flow exists to stop telling.
  if (!state.greeted) return [];
  if (state.phase === "assess") {
    return [
      { id: "assess", label: COPY.phaseAssess },
      { id: "__pending", label: COPY.railPending, pending: true },
    ];
  }
  return FALLBACK_PHASES.map((id) => ({ id, label: FALLBACK_PHASE_LABEL[id] ?? id }));
}

export function PlanRail({ state }: { state: SessionState }) {
  const reduced = useReducedMotion();
  const steps = railSteps(state);
  const seen = new Set(state.phaseSeen);
  let current = steps.findIndex((s) => s.id === state.phase);
  // The live phase may not be one of the planned steps — `assess`, between the
  // plan landing and the journey being answered, is the everyday case. Hold the
  // last step that DID match rather than blanking the rail.
  if (current < 0) current = state.lastStep ?? (state.plan ? 0 : -1);

  return (
    <nav aria-label="Setup progress" className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
        <span className="font-serif text-h3 text-ink">{COPY.brand}</span>
      </div>
      <div>
        <p className={`${EYEBROW} mb-2`}>{COPY.railTitle}</p>
        <ol className="space-y-0.5">
          {steps.map((step, i) => {
            const done = seen.has(step.id) && i < current;
            const active = i === current;
            return (
              <li key={step.id}>
                <div
                  aria-current={active ? "step" : undefined}
                  className="relative flex items-center gap-2.5 rounded-md px-2 py-1.5"
                >
                  {active ? (
                    <motion.span
                      layoutId="studio-step-pill"
                      className="absolute inset-0 z-0 rounded-md bg-coral/10 dark:rounded-xl dark:border dark:border-coral/30"
                      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={`relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-coral text-white"
                        : done
                          ? "bg-moss/15 text-moss"
                          : "border border-stone-300 bg-white text-steel"
                    }`}
                  >
                    {step.pending ? "?" : done ? <Check size={13} /> : i + 1}
                  </span>
                  <span
                    className={`relative z-10 min-w-0 truncate text-sm ${
                      active ? "font-semibold text-ink" : done ? "text-moss" : "text-steel"
                    } ${step.pending ? "italic" : ""}`}
                  >
                    {step.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {state.repo ? (
        <div className="mt-auto space-y-1 text-sm text-steel">
          <p className="truncate" title={state.repo}>
            {state.repo}
          </p>
          <p>{state.envFileExists ? ".env.local is already there" : ".env.local will be created"}</p>
        </div>
      ) : null}
    </nav>
  );
}
