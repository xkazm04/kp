"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, isAnyModalOpen } from "@/app/_components/Modal";
import { KBD } from "@/app/_components/ui/recipes";
import { navLabel, type WorkspaceTabId } from "./tabs";
import { deriveChords, isChordPrefix, matchChord } from "./chords";

// SHELL4 — global keyboard navigation: `g` then a mnemonic key jumps to a tab
// (g p → Pipeline, g d → Decisions, …), `?` opens this reference overlay. Every
// tab gets a chord: single letters where free, else a two-key `g <prefix><y>`
// sequence (see chords.ts). The sidebar round-trip is the app's highest-frequency
// interaction; chords are the standard power-user contract for a tool used all day.
//
// Suppression rules: never while typing (input/textarea/select/contenteditable)
// and never under an open modal (isAnyModalOpen — the dialog's own key handling
// stays authoritative). The Ctrl/Cmd+K palette binding lives in CommandPalette;
// the overlay documents it alongside the chords.

const CHORD_TIMEOUT_MS = 1500;

// Derived once from NAV_GROUPS, never hand-listed: a new tab gets a chord (and an
// overlay row) for free. Collision-free by construction (see chords.ts).
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
  // The armed `g` prefix — a timeout ref (so an abandoned chord can't fire minutes
  // later) plus the keys pressed after `g` (seqRef), which accumulate for a two-key
  // chord. Both live in refs, read inside the one document listener.
  const pendingRef = useRef<number | null>(null);
  const seqRef = useRef<string[]>([]);
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
      seqRef.current = [];
    };
    // Arm / re-arm the chord window: the same timeout resets between the `g` and each
    // subsequent key, so a two-key chord gets the same per-key grace a single one had.
    const arm = () => {
      if (pendingRef.current != null) window.clearTimeout(pendingRef.current);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        seqRef.current = [];
      }, CHORD_TIMEOUT_MS);
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
      // Armed: fold the next key into the sequence. An exact match fires; a proper
      // prefix keeps waiting (re-armed); anything else abandons the chord — so an
      // unmatched key or Escape cancels, same as the single-key version timed out.
      if (pendingRef.current != null) {
        const seq = [...seqRef.current, e.key.toLowerCase()];
        const chord = matchChord(CHORDS, seq);
        if (chord) {
          e.preventDefault();
          disarm();
          onSelectTabRef.current(chord.id);
          return;
        }
        if (isChordPrefix(CHORDS, seq)) {
          e.preventDefault();
          seqRef.current = seq;
          arm();
          return;
        }
        disarm();
        return;
      }
      if (e.key.toLowerCase() === "g" && !e.shiftKey) {
        seqRef.current = [];
        arm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      disarm();
    };
  }, []);

  if (!open) return null;
  const tabLabel = (id: WorkspaceTabId, fallback: string) => navLabel(nav, `tabs.${id}`, fallback);
  return (
    <Modal title={t("title")} subtitle={t("intro")} onClose={() => setOpen(false)} size="lg">
      <ul className="space-y-1.5">
        <li className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 text-base">
          <span className="text-ink">{t("palette")}</span>
          <kbd className={`${KBD} text-sm`}>Ctrl K</kbd>
        </li>
        {CHORDS.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 text-base">
            <span className="text-ink">{tabLabel(c.id, c.fallbackLabel)}</span>
            <span className="flex items-center gap-1">
              <kbd className={`${KBD} text-sm`}>g</kbd>
              {c.keys.map((k, i) => (
                <kbd key={i} className={`${KBD} text-sm`}>
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 border-t border-stone-100 pt-2 text-base">
          <span className="text-ink">{t("thisOverlay")}</span>
          <kbd className={`${KBD} text-sm`}>?</kbd>
        </li>
      </ul>
    </Modal>
  );
}
