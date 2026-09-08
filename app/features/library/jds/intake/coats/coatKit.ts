// The intake studio's COAT lane: one set of data, three ways of wearing it.
//
// A coat is a visual direction for the studio's working surface. It does not
// change what the session holds, what a turn does, or what a promote means —
// those live in `useIntakeLogic` and are identical under every coat. What a coat
// owns is the component design: what a captured condition looks like, whether a
// turn is a bubble or a block, how an arriving row announces itself, and which
// controls carry a caption versus a glyph.
//
// This file is deliberately JSX-free (the `simControlCenterKit` shape): the
// vocabulary and the derivations live here so two layouts can render the SAME
// behaviour without importing each other, and so a coat can be deleted by
// removing one directory and one row.

import { useSyncExternalStore } from "react";
import type { IntakeSession } from "../jdsIntakeLogic";

/** The literal array is the vocabulary; the union and the guard derive from it. */
export const INTAKE_COAT_IDS = ["classic", "atelier", "console"] as const;
export type IntakeCoatId = (typeof INTAKE_COAT_IDS)[number];

const COAT_SET = new Set<string>(INTAKE_COAT_IDS);
export function isIntakeCoatId(value: string | null | undefined): value is IntakeCoatId {
  return typeof value === "string" && COAT_SET.has(value);
}

export const DEFAULT_INTAKE_COAT: IntakeCoatId = "classic";

/** Survives a reload so a reviewer comparing coats does not re-pick on every open. */
export const INTAKE_COAT_STORAGE_KEY = "kp-intake-coat";

export function readStoredCoat(): IntakeCoatId {
  try {
    const raw = window.localStorage.getItem(INTAKE_COAT_STORAGE_KEY);
    return isIntakeCoatId(raw) ? raw : DEFAULT_INTAKE_COAT;
  } catch {
    /* best-effort: a browser that refuses storage still gets the default coat */
    return DEFAULT_INTAKE_COAT;
  }
}

const listeners = new Set<() => void>();

export function storeCoat(coat: IntakeCoatId): void {
  try {
    window.localStorage.setItem(INTAKE_COAT_STORAGE_KEY, coat);
  } catch {
    /* best-effort: the choice is a preference, never a precondition for the session */
  }
  // Same-tab writes do not fire `storage`, so the store publishes its own.
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // A second tab picking a coat should not leave this one lying about which is on.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The coat, read through an external store rather than an effect.
 *
 *  `localStorage` does not exist while the page is rendered on the server, so a
 *  naive read during render mismatches hydration and a read inside an effect is
 *  a cascading setState (the rule that rejects it is right). `useSyncExternalStore`
 *  is the shape React provides for exactly this: the server snapshot is the
 *  baseline coat, the client snapshot is the stored one, and React reconciles the
 *  difference itself. Same mechanism as the theme store this repo already runs on. */
export function useIntakeCoat(): IntakeCoatId {
  return useSyncExternalStore(subscribe, readStoredCoat, () => DEFAULT_INTAKE_COAT);
}

/* ── What the two new coats agree on ────────────────────────────────────────
 *
 * NO SENTENCE OCCUPIES LAYOUT. A control that needs explaining carries a glyph
 * and a tooltip; the explanation is one hover or one focus away and never
 * takes a line of the desk. Three consequences the coats implement identically:
 *
 *  1. A capability that is absent is drawn in its NEGATIVE state (a struck
 *     microphone, a muted speaker) with the reason in its tooltip — not a
 *     paragraph telling the reader to continue in text.
 *  2. An option is a togglable icon with `aria-pressed`, not a checkbox beside
 *     a sentence.
 *  3. An empty region shows the SHAPE of what will fill it, not a sentence
 *     promising that it will.
 *
 * A failure the reader must act on is the exception and stays visible: an error
 * is not chrome. So is a degraded engine, because a brief built by the fallback
 * script is a different artifact and hiding that would be a lie of omission.
 */

/** Is this session still writable? Promoted sessions are frozen by contract. */
export function coatEditable(active: IntakeSession): boolean {
  return active.status === "open";
}

/** The promote options, as icon toggles rather than captioned checkboxes.
 *  `caseDesign` is opt-IN (it commissions extra work) and `marketResearch` is
 *  opt-OUT (it is cheap and almost always wanted) — the defaults the captioned
 *  version carried, kept exactly so a coat swap never changes what a click buys. */
export type PromoteOptions = { caseDesign: boolean; marketResearch: boolean };
export const DEFAULT_PROMOTE_OPTIONS: PromoteOptions = { caseDesign: false, marketResearch: true };
