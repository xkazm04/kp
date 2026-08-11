"use client";

/**
 * Shared state + step taxonomy for the Getting-started surface.
 *
 * Extracted so the baseline card and the prototype variants read from ONE
 * source of truth: the server-derived GettingStarted payload
 * (GET /api/me/getting-started, computed in app/_lib/getting-started.ts).
 * No variant may invent a step, a completion flag, or a progress number — the
 * honesty contract of this surface is that every mark reflects a real workspace
 * fact, so all derivation lives here and nowhere in a component.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import type { GettingStarted } from "@/app/_lib/getting-started";

/** Per-browser dismissal preference (the repo's convention for user-scoped UI state). */
export const DISMISS_KEY = "kp-getting-started-dismissed";

export const STEPS = [
  { key: "company", tab: "organization", target: '[data-sim="org-console"]' },
  { key: "firstRole", tab: "library", target: '[data-sim="jd-builder"]' },
  { key: "case", tab: "assignments", target: '[data-sim="dev-need"]' },
  { key: "channels", tab: "channels", target: '[data-sim="channel-inbound"]' },
  { key: "team", tab: "organization", target: '[data-sim="org-console"]' },
] as const;

export type Step = (typeof STEPS)[number];
export type StepKey = Step["key"];

/** The four core steps; `team` is a bonus and never counts toward progress. */
export const CORE_STEPS = STEPS.filter((s) => s.key !== "team");

export function stepDone(key: StepKey, d: GettingStarted): boolean {
  switch (key) {
    case "company":
      return d.company;
    case "firstRole":
      return d.firstRole === "ready";
    case "case":
      return d.caseDesigned;
    case "channels":
      return d.channels === "verified";
    case "team":
      return d.team;
  }
}

/** The row's live sub-state ("building now…"), when one applies. */
export type StepNote = "analyzing" | "failed" | "listening";

export function stepNote(key: StepKey, d: GettingStarted): StepNote | null {
  if (key === "firstRole" && d.firstRole === "analyzing") return "analyzing";
  if (key === "firstRole" && d.firstRole === "failed") return "failed";
  if (key === "channels" && d.channels === "listening") return "listening";
  return null;
}

/** How many of the four core steps are genuinely complete. */
export function coreDoneCount(d: GettingStarted): number {
  return CORE_STEPS.filter((s) => stepDone(s.key, d)).length;
}

/** The first core step that isn't done yet — the honest "do this next". */
export function nextStep(d: GettingStarted): Step | null {
  return CORE_STEPS.find((s) => !stepDone(s.key, d)) ?? null;
}

/**
 * Fetches the derived checklist and owns the dismissal preference. Polls gently
 * while on screen so a finished JD build or an arriving test application flips a
 * row without a manual reload.
 */
export function useGettingStarted() {
  const [data, setData] = useState<GettingStarted | null>(null);
  // Lazy init: SSR says hidden (data is null there anyway, so markup agrees);
  // the client reads the stored preference before the first data render.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/me/getting-started")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d as GettingStarted))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* per-browser preference only */
    }
  }, []);

  return { data, dismissed, dismiss };
}

/** Navigate to a step's real tab. */
export function useOpenStep() {
  const router = useRouter();
  return useCallback((step: Step) => router.push(`/?tab=${step.tab}`), [router]);
}

/**
 * Navigate to the step's real tab, wait for its anchor, then light a one-off
 * SimSpotlight coachmark that the next click (or Escape) clears — the guided-tour
 * spotlight reused without running the tour.
 */
export function useShowMe() {
  const router = useRouter();
  const sim = useSimulation();
  const t = useTranslations("setup.checklist");

  return useCallback(
    (step: Step) => {
      router.push(`/?tab=${step.tab}`);
      const light = () => {
        sim.coachmark({
          selector: step.target,
          title: t(`coach.${step.key}.title`),
          caption: t(`coach.${step.key}.caption`),
        });
        const clear = () => {
          sim.coachmark(null);
          document.removeEventListener("pointerdown", clear);
          document.removeEventListener("keydown", onKey);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
        document.addEventListener("pointerdown", clear);
        document.addEventListener("keydown", onKey);
      };
      let tries = 0;
      const seek = () => {
        if (document.querySelector(step.target)) {
          light();
        } else if (++tries < 25) {
          window.setTimeout(seek, 200);
        }
      };
      window.setTimeout(seek, 250);
    },
    [router, sim, t]
  );
}

/** Props every Getting-started variant receives from the switcher. */
export type GettingStartedViewProps = {
  data: GettingStarted;
  dismiss: () => void;
};
