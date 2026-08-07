"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { TextInput } from "@/app/_components/TextInput";
import { KBD } from "@/app/_components/ui/recipes";
import { recordRecent, useRecents } from "./recents";
import { paletteItemId, paletteListView } from "./workspacePaletteResults";
import { useSimulation } from "./simulation/SimulationProvider";
import { WorkspaceCommandPaletteList } from "./WorkspaceCommandPaletteList";
import { useWorkspaceCommandPaletteItems } from "./useWorkspaceCommandPaletteItems";
import { useWorkspaceCommandPaletteSearch } from "./useWorkspaceCommandPaletteSearch";
import type { PaletteItem } from "./workspaceCommandPaletteTypes";

// SHELL1 — the global command palette: one Ctrl/Cmd+K surface that searches
// candidates, pipeline entries, jobs, saved JDs and analyses (via /api/search)
// and doubles as a tab navigator (actions derived from NAV_GROUPS). Enter (or a
// click) navigates through the SAME deep links the rest of the app uses, so the
// palette can never land somewhere a sidebar click couldn't.

export function CommandPalette() {
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
  // suppressHydrationWarning on the <kbd> below owns that known, intentional
  // mismatch — no state/effect needed for a value that never changes after load.
  const kbdHint = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // Opening always starts from a clean slate (reset in the event handlers, not
  // an effect, so a stale query/result list never flashes and no synchronous
  // set-state-in-effect is needed).
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
  // palette IS the escape hatch) — but never while typing means losing work:
  // preventDefault stops the browser's own Ctrl+K (search-bar focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPalette]);

  // Modal's focus trap lands on its first focusable (the header close button);
  // a rAF runs after that effect, so the input wins the opening focus.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const recents = useRecents();
  // 5d2e0998 — the guided tour as a palette command, so the simulation's
  // chronological story stays reachable after first-run (it otherwise hides in
  // the collapsed SimBar footer pill).
  const sim = useSimulation();

  const items = useWorkspaceCommandPaletteItems({
    query,
    hits,
    search,
    recents,
    simRunning: sim.running,
    simStart: sim.start,
    nav,
    t,
  });

  // Clamp the highlight whenever the list shrinks under it.
  const active = Math.min(selected, Math.max(0, items.length - 1));

  // #3 — keep the keyboard-highlighted option scrolled into the listbox viewport.
  // aria-activedescendant moves the a11y focus but never scrolls the container, so on a
  // long result set (recents + tabs + entity hits > the 50vh list) ArrowDown slid the
  // active row out of sight. `block: "nearest"` scrolls only when it's actually clipped.
  useEffect(() => {
    if (!open) return;
    document.getElementById(paletteItemId(active))?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const go = (item: PaletteItem) => {
    // SHELL3: an entity pick is exactly the "I opened this" moment recents
    // exist to capture (tab actions aren't — they're navigation, not work).
    if (item.recent && item.href) {
      recordRecent({ type: item.recent.type, id: item.recent.id, label: item.label, href: item.href });
    }
    setOpen(false);
    if (item.action) item.action();
    else if (item.href) router.push(item.href);
  };

  // #4 — pure decision for the results region: Searching affordance, dim-stale, or
  // the no-results/empty placeholder (see workspacePaletteResults.ts).
  const listView = paletteListView({
    loading,
    queryLen: query.trim().length,
    itemCount: items.length,
    hasError: !!error,
  });

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

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-left text-sm text-steel hover:border-coral/40 hover:text-ink"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1 truncate">{t("trigger")}</span>
        <kbd suppressHydrationWarning className={`${KBD} text-[11px]`}>
          {kbdHint}
        </kbd>
      </button>

      {open ? (
        <Modal title={t("title")} onClose={() => setOpen(false)} size="xl">
          <div className="space-y-3">
            <TextInput
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="palette-results"
              aria-activedescendant={items[active] ? paletteItemId(active) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
                if (e.target.value.trim().length < 2) {
                  resetSearch();
                } else {
                  // Pending from the first keystroke (the search effect only schedules
                  // the debounced fetch), so the list can't sit on the prior query's
                  // results without a signal that a newer term is being fetched.
                  markPending();
                }
              }}
              onKeyDown={onInputKey}
              placeholder={t("placeholder")}
            />
            {error ? <p className="text-sm text-coral">{error}</p> : null}
            {listView.showSearching ? (
              <p className="px-2 text-sm text-steel" aria-live="polite">
                {t("searching")}
              </p>
            ) : null}
            <WorkspaceCommandPaletteList
              items={items}
              active={active}
              listView={listView}
              query={query}
              t={t}
              go={go}
              setSelected={setSelected}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
