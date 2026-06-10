"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, isAnyModalOpen } from "@/app/_components/Modal";
import { NAV_GROUPS, type WorkspaceTabId } from "./tabs";

// SHELL4 — global keyboard navigation: `g` then a mnemonic key jumps to a tab
// (g p → Pipeline, g d → Decisions, …), `?` opens this reference overlay. With
// 14 tabs, the sidebar round-trip is the app's highest-frequency interaction;
// chords are the standard power-user contract for a tool used all day.
//
// Suppression rules: never while typing (input/textarea/select/contenteditable)
// and never under an open modal (isAnyModalOpen — the dialog's own key handling
// stays authoritative). The Ctrl/Cmd+K palette binding lives in CommandPalette;
// the overlay documents it alongside the chords.

const CHORD_TIMEOUT_MS = 1500;

// Deterministic mnemonics: each tab takes its first not-yet-taken letter, in
// NAV_GROUPS order — so the high-frequency first group gets the obvious keys
// (p/c/d/s) and later collisions degrade predictably (profile → r). Derived,
// never hand-listed: a new tab gets a chord (and an overlay row) for free.
function deriveChords(): { id: WorkspaceTabId; fallbackLabel: string; key: string }[] {
  const taken = new Set<string>();
  const out: { id: WorkspaceTabId; fallbackLabel: string; key: string }[] = [];
  for (const def of NAV_GROUPS.flatMap((g) => g.items)) {
    const key = [...def.id].find((c) => /[a-z]/.test(c) && !taken.has(c));
    if (!key) continue; // every letter taken — the tab simply has no chord
    taken.add(key);
    out.push({ id: def.id, fallbackLabel: def.label, key });
  }
  return out;
}
const CHORDS = deriveChords();

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function KeyboardShortcuts({ onSelectTab }: { onSelectTab: (id: WorkspaceTabId) => void }) {
  const t = useTranslations("shortcuts");
  const nav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  // The armed `g` prefix — a ref (read inside the one document listener) with
  // a timeout so an abandoned chord can't fire minutes later.
  const pendingRef = useRef<number | null>(null);
  const onSelectTabRef = useRef(onSelectTab);
  useEffect(() => {
    onSelectTabRef.current = onSelectTab;
  }, [onSelectTab]);

  useEffect(() => {
    const disarm = () => {
      if (pendingRef.current != null) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // chords are bare keys
      if (isEditableTarget(e.target) || isAnyModalOpen()) return;
      if (e.key === "?") {
        e.preventDefault();
        disarm();
        setOpen(true);
        return;
      }
      if (pendingRef.current != null) {
        disarm();
        const chord = CHORDS.find((c) => c.key === e.key.toLowerCase());
        if (chord) {
          e.preventDefault();
          onSelectTabRef.current(chord.id);
        }
        return;
      }
      if (e.key.toLowerCase() === "g" && !e.shiftKey) {
        pendingRef.current = window.setTimeout(() => {
          pendingRef.current = null;
        }, CHORD_TIMEOUT_MS);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      disarm();
    };
  }, []);

  if (!open) return null;
  const tabLabel = (id: WorkspaceTabId, fallback: string) => {
    const key = `tabs.${id}` as Parameters<typeof nav>[0];
    return nav.has(key) ? nav(key) : fallback;
  };
  return (
    <Modal title={t("title")} subtitle={t("intro")} onClose={() => setOpen(false)} size="lg">
      <ul className="space-y-1.5">
        <li className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 text-base">
          <span className="text-ink">{t("palette")}</span>
          <kbd className="rounded border border-stone-200 bg-paper px-1.5 py-0.5 text-sm font-semibold text-steel">Ctrl K</kbd>
        </li>
        {CHORDS.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 text-base">
            <span className="text-ink">{tabLabel(c.id, c.fallbackLabel)}</span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-stone-200 bg-paper px-1.5 py-0.5 text-sm font-semibold text-steel">g</kbd>
              <kbd className="rounded border border-stone-200 bg-paper px-1.5 py-0.5 text-sm font-semibold text-steel">{c.key}</kbd>
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 border-t border-stone-100 pt-2 text-base">
          <span className="text-ink">{t("thisOverlay")}</span>
          <kbd className="rounded border border-stone-200 bg-paper px-1.5 py-0.5 text-sm font-semibold text-steel">?</kbd>
        </li>
      </ul>
    </Modal>
  );
}
