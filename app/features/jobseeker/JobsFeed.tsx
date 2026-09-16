"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import type { SortState } from "@/app/_components/table/useTableSort";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Select } from "@/app/_components/Select";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CHIP,
  EYEBROW,
  INTRO,
  META_LABEL,
  PAGE_HEADER,
  SECTION,
  TITLE_DISPLAY,
} from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { FeedNewSince, JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { FadeInline } from "@/app/features/hiring/pipeline/PipelineMotion";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "./apiFailure";
import { EnableEuresButton } from "./EnableEuresButton";
import { FailureNotice } from "./FailureNotice";
import { FeedEmptyState } from "./FeedEmptyState";
import { isNewerThanAnchor, renderedAnchor, resolveFeedEmptyState, shouldFetchRows, type FeedEmptyState as FeedEmptyStateName, type FeedTuple } from "./feedModel";
import { PostingRow } from "./PostingRow";
import { ScanNowButton } from "./ScanNowButton";
import { usePostingActions } from "./usePostingActions";
import { useScanTask } from "./useScanTask";

// /me/jobs — the feed over the seeker's reconciled dataset (WP4c's
// GET /api/jobseeker/postings). The server page hands in the CHAIN FACTS (profile,
// enabled sources, whether a scan ever ran) because the feed's empty state must
// name the first missing link, and the list route cannot know why it is empty.
//
// Filters are client state, not URL state (the same call the workspace tab made:
// a bookmark to "dismissed, sorted by seen" is not a thing a seeker asks for). Paging
// is the route's keyset cursor: "load more" appends, a filter change starts over.
//
// THE FEED IS A LEDGER (2026-09-16). It was thirty stacked `${PANEL} p-4` cards with a
// four-branch ternary above them that unmounted three skeleton `<li>`s of a shape the
// cards never had. It is now the studio's table register — `ColumnHead` headers that
// own `aria-sort`, `PostingRow`'s `<tr>`, one trailing action cell — under the loading
// choreography every other tab obeys: chrome on the first frame, `LoadingGap` (never a
// skeleton) in the reserved table body, rows arriving in a capped stagger.
//
// THE SORT LIVES IN THE HEADERS, and it is the ROUTE's sort, not a client comparator.
// `useTableSort` would be a lie here: the list is keyset-paged, so ordering the thirty
// rows in hand is not ordering the dataset. The three sortable columns are exactly the
// three the route offers (`sort=total|posted|seen`, all DESC in the store's ORDER BY),
// so `sort` is a derived `SortState` and `onSort` re-issues the query. Columns the
// route cannot order (role, source, status) declare no `sortCol` and therefore claim
// no sortability — which is the whole reason `ColumnHead` owns the `<th>`.

export type FeedSource = { id: string; label: string };
export type FeedChain = {
  hasProfile: boolean;
  enabledSources: number;
  hasScanned: boolean;
  countries: string[];
  /** When the last scan for this workspace finished, from the scheduler run the server
   *  page already read. Null until one ever ran — the header says nothing rather than
   *  inventing "never". */
  lastScanAt: string | null;
};

const STATUS_FILTERS = ["live", "new", "shortlisted", "applied", "dismissed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const MIN_FIT_OPTIONS = [0, 50, 65, 80] as const;
/** The route's three orderings, verbatim (`app/api/jobseeker/postings/route.ts`'s
 *  `SORTS`). It is a type and no longer an array: the vocabulary used to feed a
 *  `<select>`, and its consumers are now the three sortable `ColumnHead`s, which name
 *  their column one at a time. A value outside it is a 400, so tsc is the guard. */
type Sort = "total" | "posted" | "seen";
const PAGE = 30;
/** Every column the table declares, so a full-width `<td>` can span them honestly. */
const COLUMNS = 7;

type Query = { status: StatusFilter; minTotal: number; sourceId: string; sort: Sort };

function queryString(q: Query, cursor: string | null, minTotalOverride?: number): string {
  const p = new URLSearchParams();
  if (q.status !== "live") p.set("status", q.status);
  const min = minTotalOverride ?? q.minTotal;
  if (min > 0) p.set("minTotal", String(min));
  if (q.sourceId) p.set("sourceId", q.sourceId);
  p.set("sort", q.sort);
  p.set("limit", String(PAGE));
  if (cursor) p.set("cursor", cursor);
  return p.toString();
}

/** How long a row stays marked "just arrived". Past this the set clears, so a row that
 *  landed and then sat there is not permanently new and no unrelated re-render can
 *  replay the cascade (`IntakeArrivalMotion.ts`'s ARRIVAL_WINDOW_MS, same number). */
const ARRIVAL_WINDOW_MS = 1400;

/**
 * Which rows are ARRIVING, diffed by posting id.
 *
 * The rule inherited from `ArrivalList`: a row cascades on its FIRST appearance and
 * never again. So the first settled page cascades whole, "load more" cascades only
 * what it appended, and a filter change cascades only the ids that were not on screen
 * a moment ago — the rows that survive the filter do not move at all, which is the
 * difference between a list that re-cut itself and a list that repainted.
 */
function useRowArrival(rows: JobseekerPostingSummary[] | null): (id: string) => number {
  const seen = useRef<Set<string> | null>(null);
  const [arriving, setArriving] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!rows) return;
    const ids = rows.map((r) => r.id);
    const previous = seen.current;
    seen.current = new Set(ids);
    const fresh = previous === null ? ids : ids.filter((id) => !previous.has(id));
    if (fresh.length === 0) {
      setArriving((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    setArriving(new Map(fresh.map((id, i) => [id, i])));
    const timer = window.setTimeout(() => setArriving(new Map()), ARRIVAL_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [rows]);

  return useCallback((id: string) => arriving.get(id) ?? -1, [arriving]);
}

export function JobsFeed({ chain, sources }: { chain: FeedChain; sources: FeedSource[] }) {
  const t = useTranslations("me.jobs");
  const rel = useRelativeTime();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState<Query>({ status: "live", minTotal: 0, sourceId: "", sort: "total" });
  const [rows, setRows] = useState<JobseekerPostingSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loadError, setLoadError] = useState<ClassifiedFailure | null>(null);
  const [droppedByMin, setDroppedByMin] = useState<number | null>(null);
  const [hasScanned, setHasScanned] = useState(chain.hasScanned);
  const [newSince, setNewSince] = useState<FeedNewSince>(null);
  // The chain links the page can flip without a server round-trip: the one-click EURES
  // door enables a source, and the feed must start reading rows from that moment.
  const [enabledSources, setEnabledSources] = useState(chain.enabledSources);
  const generation = useRef(0);

  // Every setState lives in a promise callback, never synchronously: the mount effect
  // calls this, and a synchronous setState there is the cascade
  // react-hooks/set-state-in-effect forbids (useChannelsData's shape). The initial
  // wait is `rows === null`; "load more" sets `loading` in its click handler.
  const load = useCallback((q: Query, after: string | null): Promise<void> => {
    const gen = ++generation.current;
    type Page = { rows?: JobseekerPostingSummary[]; nextCursor?: string | null; newSince?: FeedNewSince; code?: string };
    return fetch(`/api/jobseeker/postings?${queryString(q, after)}`)
      .then(async (res) => ({ res, body: (await res.json().catch(() => null)) as Page | null }))
      .then(async ({ res, body }) => {
        if (gen !== generation.current) return;
        if (!res.ok || !body?.rows) {
          // Classified, not `code ?? null`: a dev server that is not running answers an
          // HTML 404, and "check that the app is running" is a different sentence from
          // "the feed could not be loaded".
          setLoadError(classifyApiFailure(res, body));
          return;
        }
        const rows = body.rows;
        setLoadError(null);
        setRows((prev) => (after && prev ? [...prev, ...rows] : rows));
        setCursor(body.nextCursor ?? null);
        setNewSince(body.newSince ?? null);
        // A capped list says what it dropped: when the min-fit filter emptied the page,
        // count what the same query holds without it (one page; "30+" past that).
        if (!after && rows.length === 0 && q.minTotal > 0) {
          const all = await fetch(`/api/jobseeker/postings?${queryString(q, null, 0)}`);
          const allBody = (await all.json().catch(() => null)) as { rows?: unknown[]; nextCursor?: string | null } | null;
          if (gen !== generation.current) return;
          setDroppedByMin(allBody?.rows ? allBody.rows.length + (allBody.nextCursor ? 1 : 0) : 0);
        } else {
          setDroppedByMin(null);
        }
      })
      .catch(() => {
        if (gen === generation.current) setLoadError(TRANSPORT_FAILURE);
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });
  }, []);

  // A broken chain is answered from the server's own facts: no request is made, so a
  // failed read can never be painted as an empty feed (feedModel.shouldFetchRows).
  const fetchRows = shouldFetchRows({ hasProfile: chain.hasProfile, enabledSources });

  useEffect(() => {
    if (!fetchRows) return;
    void load(query, null);
  }, [query, load, fetchRows]);

  // Retry re-issues exactly the failed request — the same query, from the first page —
  // and keeps the filters, the sort and the scroll position the reader had.
  const retry = useCallback(() => {
    setRetrying(true);
    void load(query, null).finally(() => setRetrying(false));
  }, [load, query]);

  const replaceRow = useCallback((row: JobseekerPostingSummary) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? row : r)) : prev));
  }, []);
  const actions = usePostingActions(replaceRow);
  const orderOf = useRowArrival(rows);

  // ── the last-seen anchor ──────────────────────────────────────────────────────────
  //
  // ONE durable anchor, advanced only when the reader demonstrably saw a SETTLED feed:
  // the tuple is taken from the rows actually rendered, and a failed or still-loading
  // page leaves it untouched (a failure is not a read). It moves on departure
  // (visibilitychange → hidden, pagehide — the two events a phone browser reliably
  // gives before it freezes the tab) and on the explicit "mark all as seen"; the store
  // refuses to move it backwards, so an out-of-order beacon is a no-op, never a rewind.
  const seenAnchor = useRef<FeedTuple | null>(null);
  useEffect(() => {
    if (rows && rows.length > 0 && !loadError) seenAnchor.current = renderedAnchor(rows);
  }, [rows, loadError]);

  const sendSeen = useCallback((tuple: FeedTuple | null) => {
    if (!tuple) return;
    const body = JSON.stringify({ at: tuple.at, id: tuple.id });
    // A departure has no time for a response: the beacon is queued by the browser and
    // survives the page. `keepalive` is the fallback where sendBeacon is missing or
    // refuses (queue full); both are best-effort by design — a lost advance costs the
    // reader one repeated "new" badge, and a WRONG advance would cost them a posting.
    try {
      if (navigator.sendBeacon?.("/api/jobseeker/profile/seen", new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* best-effort: the anchor is a convenience, never the request the reader is making */
    }
    void fetch("/api/jobseeker/profile/seen", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") sendSeen(seenAnchor.current);
    };
    const onPageHide = () => sendSeen(seenAnchor.current);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sendSeen]);

  // The explicit acknowledgement: an ordinary request (its answer IS read), and the
  // divider/count fold to zero against the tuple that was just acknowledged.
  const markAllSeen = useCallback(() => {
    const tuple = seenAnchor.current;
    if (!tuple) return;
    sendSeen(tuple);
    setNewSince({ count: 0, anchorAt: tuple.at });
  }, [sendSeen]);

  const scan = useScanTask((summary) => {
    if (summary) setHasScanned(true);
    void load(query, null);
  });

  const sourceLabel = useMemo(() => new Map(sources.map((s) => [s.id, s.label])), [sources]);
  const newCount = newSince?.count ?? 0;
  // Where the "new" run ends on THIS page: the first rendered row that is not newer than
  // the anchor. Only `sort=seen` orders the list the way the anchor orders the dataset,
  // so every other sort states the count in the header instead of drawing a line in the
  // wrong place. The anchor's id half is not on the wire (the route answers the count and
  // the timestamp), so a row that arrived in the very same millisecond as the anchor sits
  // on the new side of the line — the count is the server's, the line is an approximation
  // of where it falls.
  const dividerAt = useMemo(() => {
    if (!newSince || newCount === 0 || query.sort !== "seen" || !rows) return null;
    const anchor = { at: newSince.anchorAt, id: "" };
    const i = rows.findIndex((row) => !isNewerThanAnchor({ at: row.firstSeenAt, id: row.id }, anchor));
    return i > 0 ? i : null;
  }, [newSince, newCount, query.sort, rows]);
  const emptyState: FeedEmptyStateName = resolveFeedEmptyState({
    hasProfile: chain.hasProfile,
    enabledSources,
    hasScanned,
    rows: rows?.length ?? 0,
    liveTotal: droppedByMin ?? 0,
  });

  // The route sorts DESC on every one of its three keys (jobseeker-postings.ts's
  // ORDER BY), so the header's direction is a fact about the query, not a toggle.
  const sort: SortState<Sort> = { col: query.sort, dir: "desc" };
  const onSort = (col: Sort) => setQuery((q) => (q.sort === col ? q : { ...q, sort: col }));

  return (
    <div className={`stagger-children ${SECTION}`} aria-busy={fetchRows && rows === null ? true : undefined}>
      <header className={PAGE_HEADER}>
        <div className="min-w-0">
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
          {/* What the seeker came back to: when the crawler last looked, and — only once
              an anchor exists — how much arrived since they last did. `lastScanAt` is a
              server fact and paints on the first frame; the count is not, so it blinks
              in through FadeInline rather than shoving the line as it lands. */}
          {chain.lastScanAt || newCount > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-steel">
              {chain.lastScanAt ? <span>{t("lastScan", { when: rel(chain.lastScanAt) })}</span> : null}
              <FadeInline show={newCount > 0}>
                <span className="flex flex-wrap items-center gap-x-2">
                  {chain.lastScanAt ? <span aria-hidden>·</span> : null}
                  {/* With `sort=seen` the divider below carries the count in place. */}
                  {query.sort === "seen" ? null : <span className="font-medium text-ink">{t("newSince", { count: newCount })}</span>}
                  <button type="button" className={`${BTN_GHOST} h-7 px-2 text-sm`} onClick={markAllSeen}>
                    {t("markAllSeen")}
                  </button>
                </span>
              </FadeInline>
            </p>
          ) : null}
        </div>
        {/* The scan door is CHROME, not a reward for having rows: it used to appear only
            once the feed was non-empty, so the page grew a button under the reader as
            the first page landed. It renders whenever a scan is a thing this chain can
            do (a profile and at least one enabled source) — before that, the empty
            state's own CTA is the honest next step and a "Scan now" here would be a
            button that cannot help. */}
        {fetchRows ? <ScanNowButton scan={scan} variant="secondary" /> : null}
      </header>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <SegmentedControl
          label={t("filter.status")}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: t(`filter.statusOption.${s}`) }))}
          value={query.status}
          onChange={(status) => setQuery((q) => ({ ...q, status }))}
        />
        {/* Four fixed options is a segmented control, not a dropdown: the whole
            vocabulary fits on the rail, and the three raw `<select className={FIELD}>`
            beside the one shared-layout pill were the filter bar's loudest seam. */}
        <SegmentedControl
          label={t("filter.minFit")}
          options={MIN_FIT_OPTIONS.map((n) => ({ value: String(n), label: n === 0 ? t("filter.minFitAny") : t("filter.minFitValue", { n }) }))}
          value={String(query.minTotal)}
          onChange={(v) => setQuery((q) => ({ ...q, minTotal: Number(v) }))}
        />
        {sources.length > 1 ? (
          // An open-ended list IS a select — but the app's own `Select`, whose options
          // resolve through the theme tokens, not the OS menu a native one opens.
          <label className="flex flex-col gap-1">
            <span className={META_LABEL}>{t("filter.source")}</span>
            <Select
              value={query.sourceId}
              onChange={(sourceId) => setQuery((q) => ({ ...q, sourceId }))}
              options={sources.map((s) => ({ value: s.id, label: s.label }))}
              placeholder={t("filter.allSources")}
              ariaLabel={t("filter.source")}
              sizeVariant="sm"
              clearable
              clearLabel={t("filter.allSources")}
              className="w-44"
            />
          </label>
        ) : null}
      </div>

      {actions.error ? <FailureNotice failure={actions.error} fallback={t("actionError")} /> : null}
      {loadError ? <FailureNotice failure={loadError} fallback={t("loadError")} onRetry={retry} retrying={retrying} /> : null}

      <section aria-label={t("title")}>
        {!fetchRows || (rows !== null && rows.length === 0 && !loadError) ? (
          <EmptyState
            state={emptyState}
            droppedByMin={fetchRows ? (droppedByMin ?? 0) : 0}
            scan={scan}
            countries={chain.countries}
            onSourceEnabled={() => setEnabledSources((n) => n + 1)}
          />
        ) : rows === null && loadError ? null : (
          // Tier 2 (loading-choreography.md): the region resolves later, so it fades in
          // where it stands. Keyed on settled-vs-waiting so the class plays on the swap
          // — `animate-arrive-in` only animates on element creation — and nested one
          // level below the staggered container, never as a direct child of it.
          <div key={rows === null ? "waiting" : "settled"} className="animate-arrive-in space-y-3">
            <div className="overflow-x-auto rounded-lg border border-stone-200">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-stone-200 bg-paper/60">
                    {/* The widths live on the HEADER cells, where a table's column
                        allocation belongs: `w-20` pins fit to a numeral, `w-full` makes
                        role the greedy column that absorbs everything the fixed ones
                        leave. Every other column is `whitespace-nowrap` and therefore
                        sized by its own content. */}
                    <ColumnHead title={t("table.fit")} sortCol="total" sort={sort} onSort={onSort} align="right" className="w-20 px-3 pt-2" />
                    <ColumnHead title={t("table.role")} sort={sort} onSort={onSort} className="w-full px-3 pt-2" />
                    <ColumnHead title={t("table.source")} sort={sort} onSort={onSort} className="hidden px-3 pt-2 md:table-cell" />
                    <ColumnHead title={t("table.posted")} sortCol="posted" sort={sort} onSort={onSort} className="hidden px-3 pt-2 lg:table-cell" />
                    <ColumnHead title={t("table.seen")} sortCol="seen" sort={sort} onSort={onSort} className="hidden px-3 pt-2 sm:table-cell" />
                    <ColumnHead title={t("table.status")} sort={sort} onSort={onSort} className="px-3 pt-2" />
                    <th scope="col" className={`px-3 pb-2 pt-2 text-right ${META_LABEL}`}>
                      <span className="sr-only">{t("table.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    // NO SKELETON. A reserved, quiet, NAMED box the height of a first
                    // page, so the table's chrome is already the page the rows land in.
                    <tr>
                      <td colSpan={COLUMNS} className="p-0">
                        <LoadingGap className="min-h-[18rem]" label={t("loading")} />
                      </td>
                    </tr>
                  ) : (
                    // FLAT, not fragments: AnimatePresence tracks its DIRECT children by
                    // key, and a keyed Fragment wrapping a row hides that row from it —
                    // so the divider and the rows are emitted into one flat list.
                    <AnimatePresence initial={false}>
                      {rows.flatMap((row, i) => [
                        ...(i === dividerAt
                          ? [
                              // Sorted by last seen, the boundary is a place on the page,
                              // so the count is rendered AS that place. The cell's content
                              // grows from zero height (Collapse's shape, inlined because
                              // a `<tr>` cannot host Collapse's own wrapper div), so the
                              // rows below are pushed rather than jumped.
                              <motion.tr key="new-divider" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <td colSpan={COLUMNS} className="p-0">
                                  <motion.div
                                    className="overflow-hidden"
                                    initial={reduced ? false : { height: 0 }}
                                    animate={{ height: "auto" }}
                                    transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                                  >
                                    <span className="flex items-center gap-3 px-3 py-2">
                                      <span className="h-px flex-1 bg-coral/40" />
                                      <span className={`${CHIP} shrink-0 font-medium text-ink`}>{t("newSince", { count: newCount })}</span>
                                      <span className="h-px flex-1 bg-coral/40" />
                                    </span>
                                  </motion.div>
                                </td>
                              </motion.tr>,
                            ]
                          : []),
                        <PostingRow
                          key={row.id}
                          row={row}
                          sourceLabel={sourceLabel.get(row.sourceId) ?? row.sourceId}
                          busy={actions.busyId === row.id}
                          arrivalOrder={orderOf(row.id)}
                          onShortlist={(next) => void actions.setStatus(row.id, next ? "shortlisted" : "new")}
                          onApplied={() => void actions.markApplied(row)}
                          onDismiss={(reason, note) => void actions.setStatus(row.id, "dismissed", { reason, note })}
                          onRestore={() => void actions.setStatus(row.id, "new")}
                        />,
                      ])}
                    </AnimatePresence>
                  )}
                </tbody>
              </table>
            </div>
            {cursor ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  className={`${BTN_SECONDARY} h-9 px-4 text-sm`}
                  disabled={loading}
                  onClick={() => {
                    setLoading(true);
                    void load(query, cursor);
                  }}
                >
                  {loading ? t("loading") : t("loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

/** One empty state per missing link of the chain, each with the ONE next step that
 *  fixes it — in the house empty-state register (FeedEmptyState.tsx). */
function EmptyState({
  state,
  droppedByMin,
  scan,
  countries,
  onSourceEnabled,
}: {
  state: FeedEmptyStateName;
  droppedByMin: number;
  scan: ReturnType<typeof useScanTask>;
  countries: string[];
  onSourceEnabled(): void;
}) {
  const t = useTranslations("me.jobs.empty");
  if (state === "ok") return null;
  const cta =
    state === "no_profile" ? (
      <Link href="/me" className={`${BTN_PRIMARY} h-10 px-4`}>
        {t("no_profile.cta")}
      </Link>
    ) : state === "no_sources" ? (
      // One click to first results: EURES is tier A (no acknowledgement), so the whole
      // chain — create-or-find the source, switch it on, run the first scan — fits
      // behind one button. The full list stays a step away for everyone else.
      <>
        <EnableEuresButton countries={countries} scan={scan} onEnabled={onSourceEnabled} />
        <Link href="/me/sources" className={`${BTN_SECONDARY} inline-flex h-9 px-4 text-sm`}>
          {t("no_sources.cta")}
        </Link>
      </>
    ) : state === "no_scan" || state === "nothing_live" ? (
      <ScanNowButton scan={scan} />
    ) : null;
  return (
    <FeedEmptyState
      state={state}
      title={t(`${state}.title`)}
      body={state === "below_min" ? t("below_min.body", { count: droppedByMin }) : t(`${state}.body`)}
      cta={cta}
    />
  );
}
