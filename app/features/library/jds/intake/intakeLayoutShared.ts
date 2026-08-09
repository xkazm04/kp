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
  counts: {
    turns: number;
    requirements: number;
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
