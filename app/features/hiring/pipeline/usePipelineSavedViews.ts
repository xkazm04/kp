"use client";

// Saved board views (PIPE5 / views-earn-their-name): the localStorage-backed list,
// the save/rename Modal state, the default-view marking + its mount-time application,
// and the pasteable share link. Split out of usePipelineTabState; it reads and writes
// the board's filter state through the usePipelineFilters handle it is given.

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl } from "@/app/features/shell/tabs";
import {
  normalizeView,
  serializeQuicks,
  serializeScoreBands,
  serializeSort,
  serializeSources,
  setsEqual,
  type SavedView,
} from "./pipelineBoardFilters";
import {
  defaultViewId,
  defaultViewToApply,
  withDefault,
  upsertViewByName,
  renameStoredView,
} from "./pipelineViews";
import { copyText } from "@/app/_lib/export-utils";
import { VIEW_PARAM_KEYS, newViewId } from "./pipelineTabHelpers";
import { readStoredViews, writeStoredViews } from "./pipelineBoardStorage";
import { usePipelineTenant } from "./usePipelineTenant";
import type { PipelineFilters } from "./usePipelineFilters";

export function usePipelineSavedViews({ filters }: { filters: PipelineFilters }) {
  const search = useSearchParams();
  // board-storage-is-keyed-by-tenant — the workspace this document belongs to. The
  // list used to live under one bare `kp.pipelineViews` for the whole browser, and
  // localStorage is scoped to the ORIGIN, not the session: after a team switch, team
  // A's view NAMES hydrated onto team B's board and a view A had marked DEFAULT
  // auto-applied A's filter combination on B's bare visit. `null` until it resolves,
  // and nothing is read, written or auto-applied while it is null.
  const workspaceId = usePipelineTenant();
  const { query, quicks, scoreBands, sources, sort, stageFilter } = filters;
  // Saved board views (PIPE5): named {search + quick-filter} presets a recruiter
  // returns to, persisted in localStorage (single board, client-only — no schema).
  const [views, setViews] = useState<SavedView[]>([]);
  // views-earn-their-name — hydration + default application live together in one mount
  // effect defined AFTER applyView (below), so a marked default can open on a bare
  // visit while an explicit shared link still wins.
  const persistViews = (next: SavedView[]) => {
    setViews(next);
    // An unresolved tenant writes NOTHING — a named view we cannot attribute to a
    // team must not be persisted "somewhere"; the in-memory list still works.
    writeStoredViews(localStorage, workspaceId, next);
  };
  // PIPE3 — a saved view as a pasteable link: built from a CLEAN query string
  // (not the current one) so the share never drags along unrelated params.
  const [copiedViewId, setCopiedViewId] = useState<string | null>(null);
  // The "copied!" reset timer, held so unmount can cancel it. It used to be a bare
  // window.setTimeout: closing the board (a tab switch) inside the 2s window left a
  // timer that fired a setState on an unmounted hook — a React warning in dev and, on
  // a fast tab-flip loop, a small pile of live timers.
  const copyResetRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyResetRef.current), []);
  const copyViewLink = async (v: SavedView) => {
    // Encode the WHOLE view (compound quicks + score/source facets + sort + stage) so
    // a shared link reopens exactly the board the sharer saved — a view saved with an
    // active funnel stage or a score band used to share a link that silently dropped
    // it. Normalize first so a legacy single-quick view still shares correctly.
    const nv = normalizeView(v);
    const href = `${window.location.origin}${buildUrl(
      {
        tab: "pipeline",
        q: nv.query.trim() || null,
        quick: serializeQuicks(new Set(nv.quicks)),
        score: serializeScoreBands(new Set(nv.scoreBands)),
        source: serializeSources(new Set(nv.sources)),
        sort: serializeSort(nv.sort),
        stage: nv.stage,
      },
      ""
    )}`;
    if (await copyText(href)) {
      setCopiedViewId(v.id);
      window.clearTimeout(copyResetRef.current); // a second copy restarts the window
      copyResetRef.current = window.setTimeout(
        () => setCopiedViewId((cur) => (cur === v.id ? null : cur)),
        2000
      );
    }
  };
  // PIPE5 — save the current filter combo as a named view, apply one, or drop it.
  // The active-view match compares the WHOLE normalized shape (compound quicks +
  // score/source facets + sort + stage, order-independently) so a view isn't falsely
  // marked active just because part of it agrees, and a legacy single-quick view
  // still matches once normalized.
  const activeViewId =
    views.find((v) => {
      const nv = normalizeView(v);
      return (
        nv.query === query &&
        setsEqual(quicks, nv.quicks) &&
        setsEqual(scoreBands, nv.scoreBands) &&
        setsEqual(sources, nv.sources) &&
        nv.sort === sort &&
        nv.stage === stageFilter
      );
    })?.id ?? null;
  // views-earn-their-name — save/rename run through the app's Modal idiom (no more
  // window.prompt, the board's last blocking native dialog). One dialog state serves
  // both: `save` names+captures the current combo (with an optional "open by default"
  // toggle); `rename` relabels an existing view, keeping its identity.
  const [viewDialog, setViewDialog] = useState<
    | { mode: "save"; name: string; asDefault: boolean }
    | { mode: "rename"; id: string; name: string }
    | null
  >(null);
  const openSaveView = () =>
    setViewDialog({ mode: "save", name: query.trim() || (quicks.size ? [...quicks][0] : ""), asDefault: false });
  const openRenameView = (v: SavedView) => setViewDialog({ mode: "rename", id: v.id, name: v.name });
  const commitViewDialog = () => {
    if (!viewDialog) return;
    const name = viewDialog.name.trim();
    if (!name) return;
    if (viewDialog.mode === "rename") {
      persistViews(renameStoredView(views, viewDialog.id, name));
    } else {
      // Capture the WHOLE active combo — every facet the recruiter is looking at, so
      // the view reopens the same board. `quick` (single) is written too for forward
      // back-compat with any older reader. A fresh opaque id decouples the view from
      // its name (a later rename keeps identity). Saving under an existing name
      // overwrites (upsertByName) — the modal makes that explicit.
      const view: SavedView = {
        id: newViewId(),
        name,
        query,
        quicks: [...quicks],
        quick: quicks.size ? [...quicks][0] : null,
        score: [...scoreBands],
        source: [...sources],
        sort,
        stage: stageFilter,
        isDefault: viewDialog.asDefault ? true : undefined,
      };
      let next = upsertViewByName(views, view);
      if (viewDialog.asDefault) next = withDefault(next, view.id);
      persistViews(next);
    }
    setViewDialog(null);
  };
  // Toggle the DEFAULT marking on a view — the one that opens on a bare visit. Clicking
  // the current default clears it (so a board can have no default again).
  const toggleDefaultView = (v: SavedView) =>
    persistViews(withDefault(views, defaultViewId(views) === v.id ? null : v.id));
  const applyView = (v: SavedView) => {
    const nv = normalizeView(v);
    filters.setAllFilters({
      q: nv.query,
      quicks: new Set(nv.quicks),
      scoreBands: new Set(nv.scoreBands),
      sources: new Set(nv.sources),
      sort: nv.sort,
      stage: nv.stage,
    });
  };
  const deleteView = (id: string) => persistViews(views.filter((v) => v.id !== id));

  // Hydration + default application (views-earn-their-name). localStorage is
  // client-only, so this reads it in an effect (the SSR-safe path — a lazy initializer
  // would mismatch the server's empty HTML). readStoredViews migrates the legacy bare-
  // array shape and enforces one default.
  //
  // board-storage-is-keyed-by-tenant — it runs on the TENANT, not on mount: while
  // `workspaceId` is null the board shows no saved views and applies no default, so a
  // team switch can never open the previous team's filter combination. `appliedFor`
  // keeps the default a ONE-TIME application per resolved workspace (a re-render must
  // not yank the filters back).
  //
  // PRECEDENCE is unchanged: an explicit shared/deep link (any VIEW_PARAM_KEYS present)
  // WINS — only a bare visit applies the marked default, so a pasted link opens exactly
  // what it encodes.
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    const loaded = readStoredViews(localStorage, workspaceId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tenant-keyed localStorage hydration; an initializer would mismatch the server's empty HTML
    setViews(loaded);
    if (appliedFor.current === workspaceId) return;
    appliedFor.current = workspaceId;
    const hasExplicit = VIEW_PARAM_KEYS.some((k) => search.get(k) != null);
    const def = defaultViewToApply(loaded, hasExplicit);
    if (def) applyView(def);
    // Tenant-keyed, one-shot: applyView/search are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
    views,
    viewDialog,
    setViewDialog,
    openSaveView,
    openRenameView,
    commitViewDialog,
    toggleDefaultView,
    applyView,
    deleteView,
    activeViewId,
    copyViewLink,
    copiedViewId,
  };
}

export type PipelineSavedViews = ReturnType<typeof usePipelineSavedViews>;
