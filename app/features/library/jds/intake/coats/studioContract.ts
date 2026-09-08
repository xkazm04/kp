// The intake studio's CONTRACT: the doctrine the one surface obeys, plus the
// small vocabulary it needs to obey it.
//
// This file used to be `coatKit.ts`, the JSX-free vocabulary behind a three-way
// coat switch (classic · atelier · console). The switch is gone — Atelier won,
// with Console's Job-description sheet fused into it — so the coat id, its
// storage and its store hook went with it. What survives is what has a caller:
// the doctrine below, the editability rule, the promote defaults, and the zone
// vocabulary the desk's fold preference is written in (it arrived here from
// `intakeLayoutShared.ts`, which described a layout that no longer exists).

import type { IntakeSession } from "../jdsIntakeLogic";

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
 *  version carried, kept exactly so the consolidation never changed what a
 *  click buys. */
export type PromoteOptions = { caseDesign: boolean; marketResearch: boolean };
export const DEFAULT_PROMOTE_OPTIONS: PromoteOptions = { caseDesign: false, marketResearch: true };

/* ── The desk's zones ───────────────────────────────────────────────────────
 *
 * Which zones a requestor keeps open is a per-browser layout PREFERENCE, not
 * data, so it lives in localStorage and never on the server. SSR-safe: read
 * lazily, swallow storage errors. */

export type IntakeColumnKey = "draft" | "chat" | "brief" | "materials";

export function readStoredColumns(storageKey: string, fallback: IntakeColumnKey[]): IntakeColumnKey[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter((v): v is IntakeColumnKey => v === "draft" || v === "chat" || v === "brief" || v === "materials");
    return valid.length > 0 ? valid : fallback;
  } catch {
    /* best-effort: a browser that refuses storage still gets the default zones */
    return fallback;
  }
}

export function storeColumns(storageKey: string, open: IntakeColumnKey[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(open));
  } catch {
    /* storage unavailable — the preference just doesn't persist */
  }
}

/** Toggle with the min-one-open guard: the last open zone cannot be hidden (an
 *  all-spine desk would strand the requestor with no content at all). */
export function toggleColumn(open: IntakeColumnKey[], key: IntakeColumnKey): IntakeColumnKey[] {
  if (open.includes(key)) {
    if (open.length === 1) return open;
    return open.filter((k) => k !== key);
  }
  return [...open, key];
}
