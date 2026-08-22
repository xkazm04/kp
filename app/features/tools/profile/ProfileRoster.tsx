"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/shell/tabs";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ProfileEmptyState } from "./ProfileEmptyStates";
import { ProfileRosterTable } from "./ProfileRosterTable";
import {
  rosterFacets,
  rosterRows,
  type RosterFilters,
  type RosterSort,
  type RosterStatus,
} from "./profileRosterView";
import type { RosterProfile, StaleMap } from "./ProfileRosterTypes";
import type { ArchetypeDef } from "@/app/features/shared/profileTypes";

// The roster of SAVED candidate profiles. Each row carries the actions a recruiter
// needs: Edit (reuses the ?edit= editor flow via the parent), Match (deep-links to
// the Matrix tab's candidate focus with this profile preselected + auto-run),
// Rebuild (when a newer CV analysis exists) and a confirm-guarded Delete.
//
// It used to be a plain <ul> rendering EVERY saved profile, unfiltered and unsorted,
// as a stack of two-line cards. That reads fine at a demo's dozen and falls apart at
// a real workspace's hundreds: no way to find one candidate, no way to see who is
// least complete, and a scroll with no end in sight. This is the same register the
// Channels comms ledger uses — one row per profile, filters that live IN the column
// headers, a sort on the columns that have an order, and a fixed 20-row window
// (_components/table/TablePager) so the header, the rows and the pager stay on one
// screen.
//
// Render cascade: the CHROME — panel header, column headers, filters — depends on
// nothing but client state, so it paints on the first frame; only the rows wait for
// /api/profile.
export function ProfileRoster({
  onEdit,
  onRebuild,
  onChanged,
  archivedArchetypeIds,
  archetypes,
  onNewProfile,
}: {
  /** Open the editor for this profile id (parent reuses the ?edit= flow). */
  onEdit: (id: string) => void;
  /** Re-point this profile at the newer same-CV analysis (divergence check first).
   *  A CALLBACK, not a URL push: the roster only ever renders inside the tab that
   *  owns the rebuild flow, so pushing `?fromAnalysis=…&rebuild=…` navigated the tab
   *  to itself — the deep-link effect that reads those params runs once at mount and
   *  the panel never remounts, so the button did nothing at all. */
  onRebuild: (id: string, newerSlug: string) => void;
  /** Fired after a delete so sibling views (the matrix) can refetch. */
  onChanged?: () => void;
  /** Ids of retired archetypes — a profile routed to one still works but is flagged. */
  archivedArchetypeIds?: readonly string[];
  /** The live archetype registry — read only by the first-run empty state. */
  archetypes?: ArchetypeDef[];
  /** Open the editor in create mode (the empty state's primary action). */
  onNewProfile?: () => void;
}) {
  const t = useTranslations("profile.roster");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const router = useRouter();
  const [profiles, setProfiles] = useState<RosterProfile[] | null>(null);
  const [stale, setStale] = useState<StaleMap>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState<RosterFilters>({ q: "", archetype: "", family: "", status: "" });
  const [sort, setSort] = useState<RosterSort>({ col: "name", dir: "asc" });
  const [page, setPage] = useState(0);
  const archivedSet = useMemo(() => new Set(archivedArchetypeIds ?? []), [archivedArchetypeIds]);

  // Any filter change re-cuts the result set, so it also returns to the first page:
  // staying on page 3 of a list that just became a different list is disorienting,
  // and the clamp below only catches the case where the list got shorter.
  const patchFilters = useCallback((patch: Partial<RosterFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }, []);

  const load = useCallback(() => {
    let alive = true;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        if (!alive) return;
        // The localized fallback, never the server's English `error` — the same rule
        // the delete path below already follows (app/_lib/use-error-message.ts). This
        // read used to `setError(p.error)`, so a failing GET /api/profile put a raw
        // English sentence (or a bare SQLite message) in front of a cs/de/fr reader.
        // The route's failure body carries no machine `code` to resolve, so the
        // catalog string IS the whole honest answer here.
        if (p.error) setError(t("loadFailed"));
        else {
          setProfiles((p.profiles as RosterProfile[]) ?? []);
          setStale((p.stale as StaleMap) ?? {});
        }
      })
      .catch(() => {
        if (alive) setError(t("loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  // Match is no longer its own tab: the per-candidate ranking, the weights and the
  // shortlist filing all moved into Matrix as its candidate-focus mode, so this
  // deep link points at the one surface that still runs it.
  const runMatch = (id: string) => router.push(buildUrl({ tab: "matrix", profile: id }, ""));

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/profile?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        const payload = await r.json().catch(() => null);
        throw new Error(errMsg(payload as { error?: string; code?: string } | null, t("deleteFailed")));
      }
      setConfirmingId(null);
      // Optimistic local prune, then tell the matrix to refetch.
      setProfiles((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("deleteFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const all = useMemo(() => profiles ?? [], [profiles]);
  const loading = profiles === null;
  // Facets list only what is actually PRESENT, localized and collated for the active
  // locale (a plain .sort() puts Č/Ř/Š/Ž after Z, which reads as broken in cs).
  const statusLabel = useCallback((s: RosterStatus) => t(`status_${s}` as "status_current"), [t]);
  const view = useMemo(
    () => ({
      facets: rosterFacets(all, { locale, enumLabel, stale, archivedSet, statusLabel }),
      rows: rosterRows(all, { filters, sort, stale, archivedSet, locale, enumLabel }),
    }),
    [all, filters, sort, stale, archivedSet, locale, enumLabel, statusLabel]
  );
  const filtered = view.rows;
  // Clamped, not reset: filtering down to fewer pages while the reader sits on the
  // last one must land them on a page that exists, without an effect that could
  // fight the setter above.
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-h2 text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
      </header>

      <div className="mt-4 space-y-3">
        {error ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">
            {error}
          </p>
        ) : null}

        {/* The count reads off the FILTERED set with the total beside it, so a
            narrowed list never looks like a roster that lost rows. */}
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {loading ? (
            <span className="reveal-quiet inline-block h-4 w-24 rounded bg-stone-100" aria-hidden />
          ) : (
            <p className="text-sm text-steel">
              {filtered.length === all.length
                ? t("count", { count: all.length })
                : t("countFiltered", { shown: filtered.length, total: all.length })}
            </p>
          )}
        </div>

        {!loading && all.length === 0 ? (
          <ProfileEmptyState view="list" archetypes={archetypes ?? []} onNewProfile={onNewProfile} />
        ) : (
          <>
            <ProfileRosterTable
              shown={shown}
              loading={loading}
              // A filter cut the list to nothing: a recoverable message, NOT the
              // illustrated first-run brief — that would lie about the roster.
              emptyFiltered={!loading && all.length > 0 && filtered.length === 0}
              onClearFilters={() => patchFilters({ q: "", archetype: "", family: "", status: "" })}
              filters={filters}
              onFilters={patchFilters}
              facets={view.facets}
              sort={sort}
              onSort={setSort}
              stale={stale}
              archivedSet={archivedSet}
              confirmingId={confirmingId}
              busyId={busyId}
              onEdit={onEdit}
              onMatch={runMatch}
              onRebuild={onRebuild}
              onStartDelete={setConfirmingId}
              onCancelDelete={() => setConfirmingId(null)}
              onConfirmDelete={remove}
            />
            <TablePager page={safePage} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>
    </section>
  );
}
