// SHELL4 — the `g`-prefixed keyboard chords that jump to a tab. Pure derivation
// (no React / next-intl), so it unit-tests directly and both the listener and the
// `?` overlay in KeyboardShortcuts.tsx consume the same source of truth.
//
// The scheme, deterministic and collision-free BY CONSTRUCTION:
//   Pass 1 — single letters: each tab claims the first letter of its id not yet
//     taken, in NAV_GROUPS order. This is exactly the original algorithm, so every
//     tab that had a single-letter chord keeps the same one (p/c/d/s/… — pinned by
//     chords.test.ts). The high-frequency first group gets the obvious keys.
//   Pass 2 — two-key sequences: tabs that found no free single letter (the later
//     collisions — billing, models, branding) get `<prefix><y>`. `prefix` is the
//     first alphabet letter that is NOT a single-letter chord, so `g <prefix>` can
//     never be mistaken for a single chord (the listener knows to wait for the
//     second key); each `y` is the first still-free letter of the tab's id, so the
//     two-key chords are distinct from each other too.
//
// Collision-free proof: singles are mutually distinct (Pass 1); every two-key chord
// begins with `prefix`, which is not any single chord's key, so no single collides
// with a two-key chord's first key; and the two-key chords differ in `y`. Adding a
// tab at the end of NAV_GROUPS only draws from the still-free letters, leaving every
// prior assignment untouched (the realistic growth pattern the pin test guards).

import { NAV_GROUPS, type WorkspaceTabDef, type WorkspaceTabId } from "./tabs";

export type Chord = { id: WorkspaceTabId; fallbackLabel: string; keys: string[] };

const ALPHA = [..."abcdefghijklmnopqrstuvwxyz"];
const firstFreeIdLetter = (id: string, taken: Set<string>): string | undefined =>
  [...id].find((c) => /[a-z]/.test(c) && !taken.has(c));

export function deriveChords(): Chord[] {
  const tabs: WorkspaceTabDef[] = NAV_GROUPS.flatMap((g) => g.items);
  const singleTaken = new Set<string>();
  const keysById = new Map<WorkspaceTabId, string[]>();
  const overflow: WorkspaceTabDef[] = [];

  // Pass 1 — single letters (unchanged from the original derivation).
  for (const def of tabs) {
    const key = firstFreeIdLetter(def.id, singleTaken);
    if (key) {
      singleTaken.add(key);
      keysById.set(def.id, [key]);
    } else {
      overflow.push(def);
    }
  }

  // Pass 2 — two-key sequences for the tabs single letters couldn't cover.
  if (overflow.length) {
    // Guaranteed to exist: at most 26 single chords, far fewer tabs in practice.
    const prefix = ALPHA.find((c) => !singleTaken.has(c)) ?? "z";
    const yTaken = new Set<string>();
    for (const def of overflow) {
      const y = firstFreeIdLetter(def.id, yTaken) ?? ALPHA.find((c) => !yTaken.has(c)) ?? "z";
      yTaken.add(y);
      keysById.set(def.id, [prefix, y]);
    }
  }

  // Emit in NAV_GROUPS order so the overlay lists tabs in their sidebar order.
  return tabs.map((def) => ({ id: def.id, fallbackLabel: def.label, keys: keysById.get(def.id)! }));
}

const seqEquals = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** The chord whose full key sequence is exactly `seq`, or undefined. */
export function matchChord(chords: readonly Chord[], seq: readonly string[]): Chord | undefined {
  return chords.find((c) => seqEquals(c.keys, seq));
}

/** True when `seq` is a proper prefix of some chord's key sequence — i.e. the
 *  listener should keep waiting for the next key rather than give up. */
export function isChordPrefix(chords: readonly Chord[], seq: readonly string[]): boolean {
  return chords.some((c) => c.keys.length > seq.length && seqEquals(c.keys.slice(0, seq.length), seq));
}
