"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { labelize } from "@/app/_lib/format";
import type { CalibrationLeakage, ThresholdRecommendation } from "@/app/_lib/calibration";

// Direction 3 + family-floors — the recommendation. Deterministic, honesty-gated,
// display-only until an explicit click routes the write through the existing
// decision-config mechanism (and seals a reversible record). Never auto-applied.
//
// APPLIABILITY: the screening floor is now per-family-capable. On the all-families
// view the apply moves the GLOBAL `maxMatchToReject`; under a family filter it writes
// THAT family's bounded override (familyFloors[family]). The write is re-derived
// server-side against the SAME scope the panel showed — so the 409 staleness guard is
// honest in both cases and neither is a dead-end. `roleFamily` ("" = global) threads
// straight to the route; the recommendation's `currentThreshold` already reflects the
// scope's effective floor, so the sentence reads correctly either way.
//
// Split out of CalibrationPanel.tsx (now AnalyticsCalibrationPanel.tsx) to keep that
// file under the 200-line cap.
export function ThresholdSuggestion({
  rec,
  roleFamily,
  leakage,
  onApplied,
}: {
  rec: ThresholdRecommendation;
  roleFamily: string; // "" = global floor; a family slug = that family's override
  /** UAT KAT-L1-006 — the recommender reads the band advance rates that the floor
   *  it is proposing to move HELPED PRODUCE. That circularity is stated in the
   *  payload the panel already receives; it belongs beside the Apply button, where
   *  the irreversible-feeling click is, not in a doc. */
  leakage?: CalibrationLeakage;
  onApplied: () => void;
}) {
  const t = useTranslations("analytics.calibration");
  // The server answers a refusal with a CODE, never with prose the UI may paint
  // (api-contracts.md 1.1). This panel used to `throw new Error()` on any non-2xx and
  // print one flat sentence, so "the recommendation changed under you" (409 — reload
  // and read the new number) and "the write fell over" (500 — the floor may not have
  // moved) were the same red line. Resolve `errors.<CODE>` in the reader's language;
  // the generic sentence stays as the fallback for a code the catalog has not met.
  const errMsg = useErrorMessage();
  // The outcome of an apply is REMEMBERED WITH THE SCOPE IT MOVED.
  //
  // The panel keeps this component mounted across a role-family switch on purpose:
  // useJsonFetch holds the last-good payload rather than blanking the section
  // (loading choreography law 2), so `roleFamily` changes underneath a live
  // instance. A scope-blind `done` state therefore SURVIVED the switch and
  // re-rendered itself under the new scope's copy: apply the global floor 45 → 40,
  // select "Software engineering", and the card printed `recAppliedFamily` —
  // „Software engineering floor set to 40 (was 45)." — for a family that carries no
  // override at all, while hiding that family's own Apply button behind a done
  // state it never earned. Carrying the scope in the state makes the confirmation
  // (and a failure) speak only for the view it happened in.
  type Phase =
    | { kind: "idle" }
    | { kind: "applying" }
    | { kind: "done"; scope: string; previous: number; next: number }
    | { kind: "error"; scope: string; message: string };
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // A settled phase from another scope reads as `idle` here — never reset in place,
  // so an apply still in flight keeps the button disabled until its response lands.
  const shown: Phase = (phase.kind === "done" || phase.kind === "error") && phase.scope !== roleFamily ? { kind: "idle" } : phase;

  const apply = async () => {
    // Captured at the click: the response must be filed against the scope the
    // operator was actually looking at, not whatever is selected when it returns.
    const scope = roleFamily;
    setPhase({ kind: "applying" });
    try {
      const r = await fetch("/api/analytics/calibration/apply-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestedThreshold: rec.suggestedThreshold, ...(roleFamily ? { roleFamily } : {}) }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        previousThreshold?: number;
        newThreshold?: number;
        code?: string;
        error?: string;
      };
      if (!r.ok) {
        setPhase({ kind: "error", scope, message: errMsg(body, t("recError")) });
        return;
      }
      setPhase({ kind: "done", scope, previous: body.previousThreshold ?? rec.currentThreshold, next: body.newThreshold ?? rec.suggestedThreshold });
      onApplied();
    } catch {
      // The fetch itself never reached the server (offline, aborted): there is no code
      // to resolve, so the panel's own generic sentence is the honest answer.
      setPhase({ kind: "error", scope, message: t("recError") });
    }
  };

  const sentence = rec.direction === "lower" ? "recLower" : "recRaise";
  // Always the actionable amber suggestion now — the family view can act on its own
  // bounded floor, so there is no dead-end informational card any more.
  return (
    <div className="mt-5 rounded-md border border-dial-amber/40 bg-dial-amber/10 p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-dial-amber/20 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-ink">
          {t("recTag")}
        </span>
        {roleFamily ? (
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-steel">
            {t("recFamilyScope", { family: labelize(roleFamily) })}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-base text-ink">
        {t(sentence, {
          lo: rec.band.lo,
          hi: rec.band.hi,
          pct: rec.advanceRatePct,
          n: rec.n,
          current: rec.currentThreshold,
          suggested: rec.suggestedThreshold,
        })}
      </p>
      <p className="mt-1 text-sm text-steel">{t("recBasis", { total: rec.totalOutcomes })}</p>
      {/* UAT KAT-L1-006 — a suggestion derived from a score-caused label must say so
          where it is acted on. The clean arm is the check, once it clears the gate. */}
      {leakage && leakage.level === "high" ? (
        <p className="mt-2 rounded-md border border-coral/40 bg-coral/10 p-2 text-sm text-ink">{t("recLeakageCaveat")}</p>
      ) : null}
      {shown.kind === "done" ? (
        <p className="mt-2 text-sm font-medium text-moss" role="status">
          {roleFamily
            ? t("recAppliedFamily", { family: labelize(roleFamily), suggested: shown.next, previous: shown.previous })
            : t("recApplied", { suggested: shown.next, previous: shown.previous })}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={apply}
            disabled={phase.kind === "applying"}
            className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            {phase.kind === "applying" ? t("recApplying") : t("recApply", { suggested: rec.suggestedThreshold })}
          </button>
          {shown.kind === "error" ? (
            <span className="text-sm text-coral" role="alert">
              {shown.message}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** UAT KAT-ANA-6 — `recommendScreeningThreshold` returns null far more often than it
 *  returns advice (a floor at an extreme, or no band next to it carrying enough
 *  decided candidates), and the panel rendered NOTHING for it. An absent
 *  recommendation on a surface whose whole promise is "calibration that recommends"
 *  reads as a broken feature; say which gate it failed instead. Display-only. */
export function ThresholdSuggestionAbsent({
  currentThreshold,
  roleFamily,
}: {
  currentThreshold: number | null;
  roleFamily: string;
}) {
  const t = useTranslations("analytics.calibration");
  // The two null-returns the recommender can take, distinguished so the reader
  // knows whether to wait for data or to go set a floor.
  const noFloor = currentThreshold == null || currentThreshold <= 0 || currentThreshold >= 100;
  return (
    <div className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-3">
      <p className="text-sm font-medium text-ink">{t("recAbsentTitle")}</p>
      <p className="mt-1 max-w-prose text-sm text-steel">
        {noFloor ? t("recAbsentNoFloor") : t("recAbsentBody", { current: currentThreshold })}
      </p>
      {roleFamily ? (
        <p className="mt-1 max-w-prose text-sm text-steel">{t("recAbsentFamily", { family: labelize(roleFamily) })}</p>
      ) : null}
    </div>
  );
}
