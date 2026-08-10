"use client";

import type { ReactNode } from "react";

// Prototype round 1 (the /prototype loop): shared contract for the session-view
// layout variants. The PANEL builds the pane CONTENT once (chat, live brief, JD
// draft, materials — the existing components, untouched); a variant only
// re-ARRANGES those nodes and owns its column show/hide state. Counts feed the
// collapsed affordances (a hidden column must still say what it holds).

export type IntakeColumnKey = "draft" | "chat" | "brief" | "materials";

export type IntakeLayoutProps = {
  chat: ReactNode;
  brief: ReactNode;
  draft: ReactNode;
  materials: ReactNode;
  // A folded leaf's spine must still say what THAT leaf holds (UAT L1-EVA-10 ·
  // L1-HRBP-15 · L1-TOM-5 convergent, widened by L2-CONV-1). So one field per
  // leaf, each measuring its own content:
  //   chat  → turns
  //   brief → briefItems (requirements + facets + 90-day criteria — `requirements`
  //           alone reads 0 over a rich brief, because the extraction rarely
  //           fills it: the L2-CONV-1 defect)
  //   draft → draftReady, a STATE not a count (the draft is one document; a
  //           number there is meaningless, which is why the old branch borrowed
  //           its neighbour's attachment count)
  // `attachments` stays for the materials disclosure inside the draft leaf.
  counts: {
    turns: number;
    briefItems: number;
    attachments: number;
    draftReady: boolean;
  };
};

// Per-variant column visibility persisted per browser (session-local UX that
// survives a reload; deliberately NOT server state — a layout preference, not
// data). SSR-safe: read lazily, swallow storage errors.
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

// Toggle with the min-one-open guard: the last open column cannot be hidden
// (an all-spine desk would strand the requestor with no content at all).
export function toggleColumn(open: IntakeColumnKey[], key: IntakeColumnKey): IntakeColumnKey[] {
  if (open.includes(key)) {
    if (open.length === 1) return open;
    return open.filter((k) => k !== key);
  }
  return [...open, key];
}
