"use client";

// State + persistence for the prep modal's per-candidate kit overlay (spark
// interview-kit-template, WP-C). The rules live in scheduleInterviewPrepOverlay.ts; this
// hook holds the working overlay and writes it through PATCH /api/interview-prep
// `{ kitOverlay }` — the whole overlay each time, since the door REPLACES the key.
//
// SAVES ARE SERIALIZED. Every edit sends the complete overlay, so two requests racing
// could land in the wrong order and store the older state over the newer one. One write
// is in flight at a time; edits made meanwhile collapse into ONE follow-up carrying the
// latest state.

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { kitOverlayProblems, narrowKitOverlay } from "@/app/_lib/interview-kit-overlay";
import type { KitOverlay } from "@/app/_lib/interview-kit-types";
import type { PrepKitView } from "@/app/_lib/interview-prep-kit";
import { composeOverlayView } from "./scheduleInterviewPrepOverlayModel";
import type { Prep } from "./scheduleInterviewPrepTypes";

export type OverlaySaveState = "idle" | "saving" | "saved" | "failed";

export function useScheduleInterviewPrepOverlay(entryId: string, kit: PrepKitView | null, prep: Prep | null) {
  const t = useTranslations("scheduleTab.prep.overlay");
  const errMsg = useErrorMessage();

  // Seeded from the payload's stored overlay, and RE-seeded when that stored value
  // changes underneath (a regeneration's result carries it forward) — derived during
  // render, keyed on the stored JSON, so a local edit the server has not echoed back is
  // never overwritten by the same old copy.
  const storedJson = JSON.stringify(narrowKitOverlay(prep?.kitOverlay ?? null));
  const [seededFrom, setSeededFrom] = useState(storedJson);
  const [overlay, setOverlay] = useState<KitOverlay>(() => JSON.parse(storedJson) as KitOverlay);
  if (seededFrom !== storedJson) {
    setSeededFrom(storedJson);
    setOverlay(JSON.parse(storedJson) as KitOverlay);
  }

  const view = useMemo(
    () => (kit ? composeOverlayView(kit.kit, prep, overlay, { cvProbesRide: kit.cvProbesRide }) : null),
    [kit, prep, overlay]
  );
  const problems = view ? kitOverlayProblems(overlay, view.keptKitMustAsks) : [];

  const [saveState, setSaveState] = useState<OverlaySaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const queued = useRef<KitOverlay | null>(null);

  const persist = async (first: KitOverlay) => {
    if (inFlight.current) {
      queued.current = first;
      return;
    }
    inFlight.current = true;
    setSaveState("saving");
    setSaveError(null);
    let next: KitOverlay | null = first;
    let failed = false;
    while (next) {
      queued.current = null;
      try {
        const r = await fetch(`/api/interview-prep?entry=${encodeURIComponent(entryId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kitOverlay: next }),
        });
        const p = (await r.json().catch(() => null)) as { code?: string } | null;
        failed = !r.ok;
        if (!r.ok) setSaveError(errMsg(p, t("saveFailed")));
      } catch {
        failed = true;
        setSaveError(t("saveFailed"));
      }
      next = queued.current;
    }
    inFlight.current = false;
    setSaveState(failed ? "failed" : "saved");
  };

  /** Apply one edit: locally at once, then persisted — unless the result would be
   *  refused, in which case it stays local and the problem is listed instead of a
   *  request being spent on a known refusal. */
  const apply = (next: KitOverlay) => {
    if (next === overlay) return;
    setOverlay(next);
    // Judged against the kit AS THE NEXT OVERLAY LEAVES IT: dropping a kit must-ask frees
    // the budget an added one is checked against.
    const nextView = kit ? composeOverlayView(kit.kit, prep, next, { cvProbesRide: kit.cvProbesRide }) : null;
    if (nextView && kitOverlayProblems(next, nextView.keptKitMustAsks).length === 0) void persist(next);
  };

  return { t, overlay, view, problems, apply, saveState, saveError };
}

export type PrepOverlayLogic = ReturnType<typeof useScheduleInterviewPrepOverlay>;
