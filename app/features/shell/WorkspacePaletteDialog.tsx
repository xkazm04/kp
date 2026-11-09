"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import type { Capability } from "@/app/_lib/auth/roles";
import { recordRecent, type RecentItem } from "./recents";
import type { WorkspaceTabId } from "./tabs";
import { paletteItemId, paletteListView } from "./workspacePaletteResults";
import { useWorkspaceCommandPaletteItems } from "./useWorkspaceCommandPaletteItems";
import { useWorkspaceCommandPaletteSearch } from "./useWorkspaceCommandPaletteSearch";
import { WorkspacePaletteLedger } from "./WorkspacePaletteLedger";
import type { PaletteItem, PaletteViewProps } from "./workspaceCommandPaletteTypes";

// The OPEN half of the command palette: the query, the /api/search hook, the item
// builder and the ledger with its preview pane. It mounts only while the palette is
// open, so CommandPalette (WorkspaceCommandPalette.tsx) loads it through next/dynamic
// and the workspace's first load carries the trigger and the Ctrl/Cmd+K listener, not
// the surface. Unmounting on close is also what gives every open a clean slate: the
// query, the selection and the search state start empty on each mount.
//
// What stays in the host, deliberately: everything that must run while the palette is
// CLOSED (useRecentTabs records each tab switch; useSetupUnfinished owns its fetch and
// its live-refresh subscription) and the providers' context reads, which are cheap.

export type PaletteDialogProps = {
  title: string;
  kbdHint: string;
  search: string;
  recents: RecentItem[];
  recentTabs: WorkspaceTabId[];
  capabilities: readonly Capability[] | null;
  simRunning: boolean;
  simStart: () => void;
  simPaused: boolean;
  simPause: (() => void) | null;
  simResume: (() => void) | null;
  simStop: (() => void) | null;
  askCandi: ((q: string) => void) | null;
  finishSetup: (() => void) | null;
  onClose: () => void;
};

export function PaletteDialog({
  title,
  kbdHint,
  search,
  recents,
  recentTabs,
  capabilities,
  simRunning,
  simStart,
  simPaused,
  simPause,
  simResume,
  simStop,
  askCandi,
  finishSetup,
  onClose,
}: PaletteDialogProps) {
  const t = useTranslations("palette");
  const nav = useTranslations("nav");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { hits, error, loading, reset: resetSearch, markPending } = useWorkspaceCommandPaletteSearch(true, query, t);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Modal's focus trap lands on its first focusable; a rAF runs after that
  // effect, so the input wins the opening focus.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const items = useWorkspaceCommandPaletteItems({
    query,
    hits,
    search,
    recents,
    recentTabs,
    simRunning,
    simStart,
    simPaused,
    simPause,
    simResume,
    simStop,
    askCandi,
    finishSetup,
    capabilities,
    nav,
    t,
  });

  // Clamp the highlight whenever the list shrinks under it.
  const active = Math.min(selected, Math.max(0, items.length - 1));

  // #3 — keep the keyboard-highlighted option scrolled into the listbox viewport.
  useEffect(() => {
    document.getElementById(paletteItemId(active))?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (item: PaletteItem) => {
    // SHELL3: an entity pick is exactly the "I opened this" moment recents capture.
    if (item.recent && item.href) {
      recordRecent({ type: item.recent.type, id: item.recent.id, label: item.label, href: item.href });
    }
    onClose();
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
    onClose,
  };

  return (
    <Modal title={title} onClose={onClose} size="3xl" placement="top" bare>
      <WorkspacePaletteLedger {...view} />
    </Modal>
  );
}
