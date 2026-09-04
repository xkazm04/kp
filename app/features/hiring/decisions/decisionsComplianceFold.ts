// The compliance posture's reads, folded — so the block on screen says which of
// its numbers the server actually confirmed.
//
// the-compliance-posture-never-guesses: both reads used to end in an empty
// `.catch(() => {})` over state seeded with plausible defaults. A failed read
// therefore left the EU regime selected and "12-month retention window" printed,
// pixel-identical to a workspace that had saved exactly those. That is the one
// thing this block must never do: the whole section exists to state honestly
// what the platform does, and a retention figure nobody answered with is a
// compliance claim invented by a default.
//
// Two independent reads, two independent folds, because they fail
// independently: /api/decisions/config carries the saved jurisdiction,
// /api/compliance carries the effective retention window derived from
// KP_CONSENT_TTL_DAYS. Pure (no hook, no sentence) — the section owns the
// translator.
import { DEFAULT_REGIME_ID, REGIME_IDS, type RegimeId } from "@/app/_lib/compliance-regimes";

/** How much of the jurisdiction on screen the server stands behind.
 *  - `saved`                the server named this regime.
 *  - `default-unconfirmed`  the read landed but carried no (valid) jurisdiction:
 *                           the default IS in effect, but nobody chose it.
 *  - `failed`               the read did not land. The default is a placeholder,
 *                           and the saved value — if any — is unknown. */
export type RegimeConfidence = "saved" | "default-unconfirmed" | "failed";

export interface CompliancePosture {
  regime: RegimeConfidence;
  jurisdiction: RegimeId;
  /** The EFFECTIVE window in months, or null when the server did not answer with
   *  one. Null is rendered as "not confirmed" — never as a number. */
  retentionMonths: number | null;
}

/** Fold a GET /api/decisions/config body into the jurisdiction + how sure we are.
 *  `landed: false` is a read that never reached the server (offline, 500, abort). */
export function foldJurisdiction(landed: boolean, payload: unknown): { regime: RegimeConfidence; jurisdiction: RegimeId } {
  if (!landed) return { regime: "failed", jurisdiction: DEFAULT_REGIME_ID };
  const j = (payload as { configs?: { compliance?: { jurisdiction?: unknown } } } | null)?.configs?.compliance?.jurisdiction;
  if (typeof j === "string" && (REGIME_IDS as readonly string[]).includes(j)) return { regime: "saved", jurisdiction: j as RegimeId };
  // A body that named a regime this build does not know is NOT a saved choice we
  // can honour — showing the default under a "saved" label would assert a framing
  // the candidate disclosure is not serving.
  return { regime: "default-unconfirmed", jurisdiction: DEFAULT_REGIME_ID };
}

/** Fold a GET /api/compliance body into the effective retention window, or null.
 *  Only a finite month count of at least 1 is a window; anything else (absent,
 *  zero, a string, NaN) is "the server did not tell us". */
export function foldRetentionMonths(landed: boolean, payload: unknown): number | null {
  if (!landed) return null;
  const m = (payload as { consentRetentionMonths?: unknown } | null)?.consentRetentionMonths;
  return typeof m === "number" && Number.isFinite(m) && m >= 1 ? m : null;
}
