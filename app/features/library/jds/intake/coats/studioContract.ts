// The intake studio's CONTRACT: what is INTAKE'S about the one surface, now that
// the surface itself is the Studio kit (app/_components/studio).
//
// This file used to be `coatKit.ts`, the JSX-free vocabulary behind a three-way
// coat switch (classic · atelier · console). The switch is gone — Atelier won,
// with Console's Job-description sheet fused into it — and in WP1 the desk it
// described was extracted into the kit, where a second consumer (the job-seeker
// dialogs) shares it. The doctrine that travelled with it — NO SENTENCE OCCUPIES
// LAYOUT — is stated once, in the kit's `studioZones.ts`, beside the toggle rule
// it constrains. What survives here is what has an intake caller: the editability
// rule, the promote defaults, and the zone vocabulary the desk's fold preference
// is written in, bound to intake's storage key.

import { readStoredZones, storeZones, toggleZone, zoneKeyGuard } from "@/app/_components/studio/studioZones";
import type { IntakeSession } from "../jdsIntakeLogic";

/** Is this session still writable? Promoted sessions are frozen by contract. */
export function coatEditable(active: IntakeSession): boolean {
  return active.status === "open";
}

/** The promote options, as icon toggles rather than captioned checkboxes.
 *  `caseDesign` is opt-IN (it commissions extra work) and `marketResearch` is
 *  opt-OUT (it is cheap and almost always wanted) — the defaults the captioned
 *  version carried, kept exactly so the consolidation never changed what a
 *  click buys. */
export type PromoteOptions = { caseDesign: boolean; marketResearch: boolean };
export const DEFAULT_PROMOTE_OPTIONS: PromoteOptions = { caseDesign: false, marketResearch: true };

/* ── The desk's zones ───────────────────────────────────────────────────────
 *
 * Which zones a requestor keeps open is a per-browser layout PREFERENCE, not
 * data, so it lives in localStorage and never on the server. The vocabulary and
 * the key are intake's; the SSR-safe reader, the writer and the min-one-open
 * toggle are the kit's, generic over the vocabulary. Intake pins nothing: its
 * conversation folds like any other zone, as it always has. */

export const INTAKE_COLUMN_KEYS = ["draft", "chat", "brief", "materials"] as const;
export type IntakeColumnKey = (typeof INTAKE_COLUMN_KEYS)[number];
export const isIntakeColumnKey = zoneKeyGuard(INTAKE_COLUMN_KEYS);

/** localStorage key of the fold preference — intake's own, never the kit's. */
export const INTAKE_COLUMNS_STORAGE_KEY = "kp-intake-atelier-cols";

export function readStoredColumns(storageKey: string, fallback: IntakeColumnKey[]): IntakeColumnKey[] {
  return readStoredZones(storageKey, fallback, isIntakeColumnKey);
}

export function storeColumns(storageKey: string, open: IntakeColumnKey[]): void {
  storeZones(storageKey, open);
}

/** Toggle with the min-one-open guard: the last open zone cannot be hidden (an
 *  all-spine desk would strand the requestor with no content at all). */
export function toggleColumn(open: IntakeColumnKey[], key: IntakeColumnKey): IntakeColumnKey[] {
  return toggleZone(open, key);
}
