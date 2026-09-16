"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP, EYEBROW, FIELD, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { FeedNewSince, JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { classifyApiFailure, TRANSPORT_FAILURE, type ClassifiedFailure } from "./apiFailure";
import { EnableEuresButton } from "./EnableEuresButton";
import { FailureNotice } from "./FailureNotice";
import { isNewerThanAnchor, renderedAnchor, resolveFeedEmptyState, shouldFetchRows, type FeedEmptyState, type FeedTuple } from "./feedModel";
import { PostingCard } from "./PostingCard";
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
const SORTS = ["total", "posted", "seen"] as const;
type Sort = (typeof SORTS)[number];
const PAGE = 30;

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

export function JobsFeed({ chain, sources }: { chain: FeedChain; sources: FeedSource[] }) {
  const t = useTranslations("me.jobs");
  const rel = useRelativeTime();
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
  // skeleton is `rows === null`; "load more" sets `loading` in its click handler.
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
  const emptyState: FeedEmptyState = resolveFeedEmptyState({
    hasProfile: chain.hasProfile,
    enabledSources,
    hasScanned,
    rows: rows?.length ?? 0,
    liveTotal: droppedByMin ?? 0,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
          {/* What the seeker came back to: when the crawler last looked, and — only once
              an anchor exists — how much arrived since they last did. A first visit has
              no anchor and says neither, which is the quiet first run. */}
          {chain.lastScanAt || newCount > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-steel">
              {chain.lastScanAt ? <span>{t("lastScan", { when: rel(chain.lastScanAt) })}</span> : null}
              {newCount > 0 ? (
                <>
                  {chain.lastScanAt ? <span aria-hidden>·</span> : null}
                  {/* With `sort=seen` the divider below carries the count in place. */}
                  {query.sort === "seen" ? null : <span className="font-medium text-ink">{t("newSince", { count: newCount })}</span>}
                  <button type="button" className={`${BTN_GHOST} h-7 px-2 text-sm`} onClick={markAllSeen}>
                    {t("markAllSeen")}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {chain.hasProfile && enabledSources > 0 && rows && rows.length > 0 ? <ScanNowButton scan={scan} variant="secondary" /> : null}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t("filter.status")}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: t(`filter.statusOption.${s}`) }))}
          value={query.status}
          onChange={(status) => setQuery((q) => ({ ...q, status }))}
        />
        <label className="flex items-center gap-1.5 text-sm text-steel">
          {t("filter.minFit")}
          <select className={`${FIELD} h-9 w-24 py-0`} value={query.minTotal} onChange={(e) => setQuery((q) => ({ ...q, minTotal: Number(e.target.value) }))}>
            {MIN_FIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("filter.minFitAny") : t("filter.minFitValue", { n })}
              </option>
            ))}
          </select>
        </label>
        {sources.length > 1 ? (
          <label className="flex items-center gap-1.5 text-sm text-steel">
            {t("filter.source")}
            <select className={`${FIELD} h-9 py-0`} value={query.sourceId} onChange={(e) => setQuery((q) => ({ ...q, sourceId: e.target.value }))}>
              <option value="">{t("filter.allSources")}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 text-sm text-steel">
          {t("sort.label")}
          <select className={`${FIELD} h-9 w-44 py-0`} value={query.sort} onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value as Sort }))}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actions.error ? <FailureNotice failure={actions.error} fallback={t("actionError")} /> : null}
      {loadError ? <FailureNotice failure={loadError} fallback={t("loadError")} onRetry={retry} retrying={retrying} /> : null}

      {!fetchRows ? (
        <EmptyState state={emptyState} droppedByMin={0} scan={scan} countries={chain.countries} onSourceEnabled={() => setEnabledSources((n) => n + 1)} />
      ) : rows === null ? (
        loadError ? null : (
        <ul className="space-y-3" aria-busy="true" aria-label={t("loading")}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={`${PANEL} p-4`}>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </li>
          ))}
        </ul>
        )
      ) : rows.length > 0 ? (
        <>
          <ul className="space-y-3">
            {rows.map((row, i) => (
              <Fragment key={row.id}>
                {/* Sorted by last seen, the boundary is a place on the page, so the count
                    is rendered AS that place. `dividerAt` is null for every other sort. */}
                {i === dividerAt ? (
                  <li className="flex items-center gap-3 pt-1" aria-hidden={false}>
                    <span className="h-px flex-1 bg-coral/40" />
                    <span className={`${CHIP} shrink-0 font-medium text-ink`}>{t("newSince", { count: newCount })}</span>
                    <span className="h-px flex-1 bg-coral/40" />
                  </li>
                ) : null}
                <PostingCard
                  row={row}
                  sourceLabel={sourceLabel.get(row.sourceId) ?? row.sourceId}
                  busy={actions.busyId === row.id}
                  onShortlist={(next) => void actions.setStatus(row.id, next ? "shortlisted" : "new")}
                  onApplied={() => void actions.markApplied(row)}
                  onDismiss={(reason, note) => void actions.setStatus(row.id, "dismissed", { reason, note })}
                  onRestore={() => void actions.setStatus(row.id, "new")}
                />
              </Fragment>
            ))}
          </ul>
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
        </>
      ) : loadError ? null : (
        // Zero rows and no failure: the chain-aware empty state, never the failure's
        // stand-in and never beside it.
        <EmptyState state={emptyState} droppedByMin={droppedByMin ?? 0} scan={scan} countries={chain.countries} onSourceEnabled={() => setEnabledSources((n) => n + 1)} />
      )}
    </div>
  );
}

/** One panel per missing link of the chain, each with the ONE next step that fixes it. */
function EmptyState({
  state,
  droppedByMin,
  scan,
  countries,
  onSourceEnabled,
}: {
  state: FeedEmptyState;
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
      <div className="space-y-3">
        <EnableEuresButton countries={countries} scan={scan} onEnabled={onSourceEnabled} />
        <Link href="/me/sources" className={`${BTN_SECONDARY} inline-flex h-9 px-4 text-sm`}>
          {t("no_sources.cta")}
        </Link>
      </div>
    ) : state === "no_scan" || state === "nothing_live" ? (
      <ScanNowButton scan={scan} />
    ) : null;
  return (
    <section className={`${PANEL} p-6`} data-empty-state={state}>
      <h2 className="font-serif text-h3 text-ink">{t(`${state}.title`)}</h2>
      <p className="mt-2 max-w-prose text-sm text-steel">{state === "below_min" ? t("below_min.body", { count: droppedByMin }) : t(`${state}.body`)}</p>
      {cta ? <div className="mt-4">{cta}</div> : null}
    </section>
  );
}
