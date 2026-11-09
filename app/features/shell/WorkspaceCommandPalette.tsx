"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { isAnyModalOpen } from "@/app/_components/Modal";
import { useRecents } from "./recents";
import { useRecentTabs } from "./recentTabs";
import { DEFAULT_TAB, resolveTabParam } from "./tabs";
import { useCapabilities } from "./useCapabilities";
import { useOptionalSimulation } from "./simulation/SimulationProvider";
import { useOptionalCompanionDock } from "./companion/CompanionDockProvider";
import { requestOnboardingReopen } from "./setup/onboardingReopen";
import { useSetupUnfinished } from "./setup/useSetupUnfinished";

// The open surface (query, search, items, ledger + preview pane) is its own chunk:
// WorkspacePaletteDialog.tsx says what moved and what stayed here. It is preloaded
// on idle after mount and again on the trigger's hover/focus, so the first Ctrl/Cmd+K
// of a session opens as fast as it did when the dialog was in the shell bundle.
const loadPaletteDialog = () => import("./WorkspacePaletteDialog");
const PaletteDialog = dynamic(() => loadPaletteDialog().then((m) => ({ default: m.PaletteDialog })));
let paletteDialogRequested = false;
function preloadPaletteDialog(): void {
  if (paletteDialogRequested) return;
  paletteDialogRequested = true;
  void loadPaletteDialog().catch(() => {
    // A failed preload (offline blip, a deploy that moved the chunk) is retried by
    // the next hover or by opening, which imports it for real.
    paletteDialogRequested = false;
  });
}

// SHELL1 — the global command palette: one Ctrl/Cmd+K surface that searches
// candidates, pipeline entries, jobs, saved JDs and analyses (via /api/search)
// and doubles as a tab navigator (actions derived from NAV_GROUPS). Enter (or a
// click) navigates through the SAME deep links the rest of the app uses, so the
// palette can never land somewhere a sidebar click couldn't.
//
// The trigger is a RAIL button (icon + label, first in the rail's bottom group,
// on the SPA shell AND the link-mode deep-link sidebar) and the surface is a
// top-centre dialog — the launcher idiom: the eye starts at the input and results
// grow downward. This host owns the trigger, the shortcut and what must run while
// closed; the open surface is WorkspacePaletteDialog (its body is
// WorkspacePaletteLedger: index + live preview pane — the /prototype winner).

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
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [open, setOpen] = useState(false);
  // The server renders "Ctrl K"; an Apple client computes "⌘K" at hydration.
  // suppressHydrationWarning on the <kbd> owns that known, intentional mismatch.
  const kbdHint = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // Opening always starts from a clean slate: the dialog mounts fresh on every open
  // (query, selection and search state live in it), so nothing stale can flash.
  const openPalette = useCallback(() => {
    preloadPaletteDialog();
    setOpen(true);
  }, []);

  // Warm the dialog's chunk once the browser is idle, so the first keyboard open
  // never waits on a download. Same idle pattern as tabChunks.ts warmLikelyTabChunks.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(preloadPaletteDialog, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preloadPaletteDialog, 1500);
    return () => window.clearTimeout(timer);
  }, []);

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

  // Read here, not in the dialog: useRecentTabs RECORDS every tab switch into session
  // storage, so it must run while the palette is closed.
  const recents = useRecents();
  const recentTabs = useRecentTabs(resolveTabParam(searchParams.get("tab")) ?? DEFAULT_TAB);
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
  const setupUnfinished = useSetupUnfinished();
  const finishSetup = sim && setupUnfinished ? requestOnboardingReopen : null;

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
        onPointerEnter={preloadPaletteDialog}
        onFocus={preloadPaletteDialog}
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
        <PaletteDialog
          title={label}
          kbdHint={kbdHint}
          search={search}
          recents={recents}
          recentTabs={recentTabs}
          capabilities={capabilities}
          simRunning={sim ? sim.running : true}
          simStart={sim ? sim.start : () => {}}
          simPaused={sim?.paused ?? false}
          simPause={sim?.pause ?? null}
          simResume={sim?.resume ?? null}
          simStop={sim?.stop ?? null}
          askCandi={askCandi}
          finishSetup={finishSetup}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
