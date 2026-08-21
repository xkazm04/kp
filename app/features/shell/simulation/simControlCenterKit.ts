"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, FileText, Mail, Radio, ShieldCheck, Trophy, Users, type LucideIcon } from "lucide-react";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { useSimulation } from "./SimulationProvider";
import type { SimPhaseId } from "./constants";

// Shared brain for the two control-center prototypes (ControlDock + CandiLauncher).
// Logic only — no JSX — so both directions render the SAME behavior in their own
// layouts. The moment a third structure needs one of these it imports, not copies.

/** The control center wears two faces. It is the guided-simulation console while a
 *  demo is live (running, just finished, or FAILED) or the page arrived through the
 *  public `?sim=auto` entry; otherwise it is the operations deck the recruiter drives.
 *
 *  `sim.error` is in the predicate because the failure path patches
 *  `{ running: false, error, status: "Failed: …" }` in ONE setState: without it the
 *  dock flipped to the ops face in the very commit that wrote the failure, so the
 *  localized reason (and the red styling SimControlDockSimFace carries for exactly
 *  this state) never painted — the in-app tour just vanished with no explanation,
 *  and the Reset that purges its (SIM) residue went with it. Only `?sim=auto` ever
 *  showed the message. Cleared by start() and reset(), both of which restore
 *  IDLE_STATE's null error, so the console still hands the deck back. */
export function useControlMode(): "sim" | "ops" {
  const sim = useSimulation();
  const params = useSearchParams();
  return sim.running || sim.done || sim.error !== null || params.get("sim") === "auto" ? "sim" : "ops";
}

/** Per-phase glyph for the chronology stepper — SIM_PHASES only carries id/label/tab,
 *  so the icon vocabulary lives here (one place, both variants). */
export const PHASE_ICON: Record<SimPhaseId, LucideIcon> = {
  design: FileText,
  source: Radio,
  match: Users,
  screen: ShieldCheck,
  interview: CalendarClock,
  offer: Mail,
  hired: Trophy,
};

export type PassSummary = {
  advanced: number;
  rejected: number;
  held: number;
  alerts: number;
  errors: number;
  evaluated: number;
};

/** One row of the dry run: what the pass would do to a candidate and why. Shaped
 *  to satisfy PassPreviewModal's `Preview.decisions` structurally. */
export type PassDecision = { entryId: string; action: string; toStage: string | null; reason: string; outcome?: string };
/** TENANCY (a43408d): `summary` is the GLOBAL sweep; `decisions` arrives already filtered
 *  to the caller's workspace. The route ships the two labels below so PassPreviewModal can
 *  reconcile them ("N of the run's M decisions are yours") instead of pairing a global
 *  headline with a partial list. Optional — the simulation builds fixtures of this shape. */
export type PassPreview = {
  summary: PassSummary;
  decisions: PassDecision[];
  workspaceDecisionCount?: number;
  decisionsWorkspace?: string | null;
};

/** Automation pass, dry-run-first — mirrors PipelineTab's AUTO3 look-before-commit
 *  grammar: the pass auto-rejects AND emails candidates, so nothing commits from a
 *  single click. The dry run pulls BOTH the decisions and the board `entries`, so
 *  the reused PassPreviewModal can name each decision by candidate (it degrades to
 *  ids without them). `committed` is the applied summary. */
export function useAutomationPass(onCommitted?: () => void) {
  const t = useTranslations("pipeline.controlCenter");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PassPreview | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [committed, setCommitted] = useState<PassSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dryRun = useCallback(async () => {
    setBusy(true);
    setCommitted(null);
    setError(null);
    try {
      // Decisions come from the dry run; candidate labels come from the board.
      const [pass, board] = await Promise.all([
        fetch("/api/automation/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: true }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/pipeline")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (pass?.summary) {
        setPreview({
          summary: pass.summary as PassSummary,
          decisions: (pass.decisions as PassDecision[]) ?? [],
          // Carried, not recomputed: the route knows how many rows it withheld.
          workspaceDecisionCount: typeof pass.workspaceDecisionCount === "number" ? pass.workspaceDecisionCount : undefined,
          decisionsWorkspace: typeof pass.decisionsWorkspace === "string" ? pass.decisionsWorkspace : null,
        });
        setEntries((board?.entries as Entry[]) ?? []);
      } else {
        setError(t("errorPreview"));
      }
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const commit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/automation/run", { method: "POST" });
      const p = await r.json().catch(() => null);
      if (r.ok && p?.summary) {
        setPreview(null);
        setCommitted(p.summary as PassSummary);
        notifyDataChanged(); // any open board/queue re-fetches
        onCommitted?.();
      } else {
        setError(t("errorRun"));
      }
    } catch {
      setError(t("errorNetwork"));
    } finally {
      setBusy(false);
    }
  }, [onCommitted, t]);

  const dismiss = useCallback(() => {
    setPreview(null);
    setCommitted(null);
    setError(null);
  }, []);

  return { busy, preview, entries, committed, error, dryRun, commit, dismiss };
}

/** Publish the bar's live height to `--sim-bar-h` so the sim overlays (offer frame,
 *  explain drawer — DOM siblings that can't inherit it) anchor just above whatever
 *  the active variant docks at the bottom. No-ops until `active` and the ref mounts. */
export function usePublishBarHeight(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || !active) {
      root.style.removeProperty("--sim-bar-h");
      return;
    }
    const publish = () => root.style.setProperty("--sim-bar-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sim-bar-h");
    };
  }, [ref, active]);
}
