"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Modal, isAnyModalOpen } from "@/app/_components/Modal";
import { recordRecent, useRecents } from "./recents";
import { useCapabilities } from "./useCapabilities";
import { paletteItemId, paletteListView } from "./workspacePaletteResults";
import { useOptionalSimulation } from "./simulation/SimulationProvider";
import { useOptionalCompanionDock } from "./companion/CompanionDockProvider";
import { useWorkspaceCommandPaletteItems } from "./useWorkspaceCommandPaletteItems";
import { useWorkspaceCommandPaletteSearch } from "./useWorkspaceCommandPaletteSearch";
import { WorkspacePaletteLedger } from "./WorkspacePaletteLedger";
import type { PaletteItem, PaletteViewProps } from "./workspaceCommandPaletteTypes";

// SHELL1 — the global command palette: one Ctrl/Cmd+K surface that searches
// candidates, pipeline entries, jobs, saved JDs and analyses (via /api/search)
// and doubles as a tab navigator (actions derived from NAV_GROUPS). Enter (or a
// click) navigates through the SAME deep links the rest of the app uses, so the
// palette can never land somewhere a sidebar click couldn't.
//
// The trigger is a RAIL button (icon + label, first in the rail's bottom group,
// on the SPA shell AND the link-mode deep-link sidebar) and the surface is a
// top-centre dialog — the launcher idiom: the eye starts at the input and results
// grow downward. This host owns all state; the body is WorkspacePaletteLedger
// (index + live preview pane — the /prototype winner).

export function CommandPalette({
  variant = "rail",
  hotkey = true,
}: {
  /** "rail" is the sidebar's icon+label tile; "bar" is the compact icon button in
   *  the mobile top bar — the palette's only door on a phone, because the rail
   *  lives inside an off-canvas <aside> that is `inert` while the drawer is shut. */
  variant?: "rail" | "bar";
  /** Does THIS instance answer Ctrl/Cmd+K? Two palettes are mounted below md (rail
   *  + top bar) and the shortcut is a document listener, so exactly one may own it
   *  — otherwise one keypress opens two dialogs, and the second lands on top of
   *  the first. The rail instance (present on every surface) is the owner. */
  hotkey?: boolean;
} = {}) {
  const t = useTranslations("palette");
  const nav = useTranslations("nav");
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { hits, error, loading, reset: resetSearch, markPending } = useWorkspaceCommandPaletteSearch(open, query, t);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The server renders "Ctrl K"; an Apple client computes "⌘K" at hydration.
  // suppressHydrationWarning on the <kbd> owns that known, intentional mismatch.
  const kbdHint = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // Opening always starts from a clean slate (reset in the event handlers, not
  // an effect, so a stale query/result list never flashes).
  const openPalette = useCallback(() => {
    setQuery("");
    resetSearch();
    setSelected(0);
    setOpen(true);
  }, [resetSearch]);

  // Mirror `open` into a ref so the document-level shortcut handler (bound
  // once) can branch on the current value without re-binding per toggle.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The global shortcut. Fires everywhere — including inside inputs (the
  // palette IS the escape hatch); preventDefault stops the browser's own Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (openRef.current) {
          e.preventDefault();
          setOpen(false);
          return;
        }
        // Never OVER another dialog. The palette navigates away, so opening it on
        // top of an unsaved edit dialog (or a confirm) stacked two focus traps and
        // let the reader Enter their way out of a form they were mid-way through.
        // Closing the palette itself is exempt — that is the branch above.
        if (isAnyModalOpen()) return;
        e.preventDefault();
        openPalette();
      }
    };
    if (!hotkey) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPalette, hotkey]);

  // Modal's focus trap lands on its first focusable; a rAF runs after that
  // effect, so the input wins the opening focus.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const recents = useRecents();
  // The palette is a NAVIGATOR: a "Go to Billing" it knows will 403, or a tour
  // command that starts a pipeline write this caller may not perform, is noise
  // that costs a click to discover. Unlike the rail — where a vanished row would
  // read as a broken build — a lookup surface simply does not offer them.
  const capabilities = useCapabilities();
  // 5d2e0998 — the guided tour as a palette command. Null on the deep-link pages
  // (no SimulationProvider there): reported as "running" so the command is
  // simply not offered.
  const sim = useOptionalSimulation();
  // Null on the deep-link pages (no CompanionDockProvider there): the "Ask Candi"
  // item is then simply not offered, rather than opening nothing.
  const companion = useOptionalCompanionDock();
  const askCandi = useMemo(
    () => (companion ? (q: string) => companion.openDock(q) : null),
    [companion]
  );
  const items = useWorkspaceCommandPaletteItems({
    query,
    hits,
    search,
    recents,
    simRunning: sim ? sim.running : true,
    simStart: sim ? sim.start : () => {},
    askCandi,
    capabilities,
    nav,
    t,
  });

  // Clamp the highlight whenever the list shrinks under it.
  const active = Math.min(selected, Math.max(0, items.length - 1));

  // #3 — keep the keyboard-highlighted option scrolled into the listbox viewport.
  useEffect(() => {
    if (!open) return;
    document.getElementById(paletteItemId(active))?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const go = (item: PaletteItem) => {
    // SHELL3: an entity pick is exactly the "I opened this" moment recents capture.
    if (item.recent && item.href) {
      recordRecent({ type: item.recent.type, id: item.recent.id, label: item.label, href: item.href });
    }
    setOpen(false);
    if (item.action) item.action();
    else if (item.href) router.push(item.href);
  };

  // #4 — pure decision for the results region (see workspacePaletteResults.ts).
  const listView = paletteListView({ loading, queryLen: query.trim().length, itemCount: items.length, hasError: !!error });

  const onQueryChange = (value: string) => {
    setQuery(value);
    setSelected(0);
    // Pending from the first keystroke (the search effect only schedules the
    // debounced fetch), so the list can't sit on the prior query's results
    // without a signal that a newer term is being fetched.
    if (value.trim().length < 2) resetSearch();
    else markPending();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(active + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      go(items[active]);
    }
  };

  const view: PaletteViewProps = {
    inputRef,
    query,
    onQueryChange,
    onInputKey,
    items,
    active,
    listView,
    error,
    kbdHint,
    t,
    nav,
    go,
    setSelected,
    onClose: () => setOpen(false),
  };

  const label = t("title");
  const triggerClass =
    variant === "bar"
      ? "focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 text-steel hover:text-ink"
      : "focus-ring flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-steel transition-colors hover:bg-stone-100 hover:text-ink";
  return (
    <>
      {/* Rail trigger — icon + label like the section buttons above it (the rail
          is the wayfinding surface), the shortcut in the tooltip. */}
      <button
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} (${kbdHint})`}
        aria-label={variant === "bar" ? label : undefined}
        className={triggerClass}
      >
        <Search size={20} aria-hidden />
        {variant === "rail" ? (
          <span className="text-[13px] font-semibold leading-tight">{label}</span>
        ) : null}
      </button>

      {open ? (
        <Modal title={label} onClose={() => setOpen(false)} size="3xl" placement="top" bare>
          <WorkspacePaletteLedger {...view} />
        </Modal>
      ) : null}
    </>
  );
}
