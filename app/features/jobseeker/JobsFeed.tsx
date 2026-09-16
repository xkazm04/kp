"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, FIELD, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { resolveFeedEmptyState, type FeedEmptyState } from "./feedModel";
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
export type FeedChain = { hasProfile: boolean; enabledSources: number; hasScanned: boolean };

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
  const resolveError = useErrorMessage();
  const [query, setQuery] = useState<Query>({ status: "live", minTotal: 0, sourceId: "", sort: "total" });
  const [rows, setRows] = useState<JobseekerPostingSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ code: string | null } | null>(null);
  const [droppedByMin, setDroppedByMin] = useState<number | null>(null);
  const [hasScanned, setHasScanned] = useState(chain.hasScanned);
  const generation = useRef(0);

  // Every setState lives in a promise callback, never synchronously: the mount effect
  // calls this, and a synchronous setState there is the cascade
  // react-hooks/set-state-in-effect forbids (useChannelsData's shape). The initial
  // skeleton is `rows === null`; "load more" sets `loading` in its click handler.
  const load = useCallback((q: Query, after: string | null): Promise<void> => {
    const gen = ++generation.current;
    type Page = { rows?: JobseekerPostingSummary[]; nextCursor?: string | null; code?: string };
    return fetch(`/api/jobseeker/postings?${queryString(q, after)}`)
      .then(async (res) => ({ res, body: (await res.json().catch(() => null)) as Page | null }))
      .then(async ({ res, body }) => {
        if (gen !== generation.current) return;
        if (!res.ok || !body?.rows) {
          setLoadError({ code: body?.code ?? null });
          return;
        }
        const rows = body.rows;
        setLoadError(null);
        setRows((prev) => (after && prev ? [...prev, ...rows] : rows));
        setCursor(body.nextCursor ?? null);
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
        if (gen === generation.current) setLoadError({ code: null });
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load(query, null);
  }, [query, load]);

  const replaceRow = useCallback((row: JobseekerPostingSummary) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === row.id ? row : r)) : prev));
  }, []);
  const actions = usePostingActions(replaceRow);

  const scan = useScanTask((summary) => {
    if (summary) setHasScanned(true);
    void load(query, null);
  });

  const sourceLabel = useMemo(() => new Map(sources.map((s) => [s.id, s.label])), [sources]);
  const emptyState: FeedEmptyState = resolveFeedEmptyState({
    hasProfile: chain.hasProfile,
    enabledSources: chain.enabledSources,
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
        </div>
        {chain.hasProfile && chain.enabledSources > 0 && rows && rows.length > 0 ? <ScanNowButton scan={scan} variant="secondary" /> : null}
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

      {actions.error ? (
        <p className="text-sm text-red-700" role="alert">
          {resolveError(actions.error, t("actionError"))}
        </p>
      ) : null}
      {loadError ? (
        <div className={`${PANEL} p-4`} role="alert">
          <p className="text-sm text-red-700">{resolveError(loadError, t("loadError"))}</p>
          <button type="button" className={`${BTN_SECONDARY} mt-2 h-8 px-3 text-sm`} onClick={() => void load(query, null)}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {rows === null && !loadError ? (
        <ul className="space-y-3" aria-busy="true" aria-label={t("loading")}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={`${PANEL} p-4`}>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </li>
          ))}
        </ul>
      ) : rows && rows.length > 0 ? (
        <>
          <ul className="space-y-3">
            {rows.map((row) => (
              <PostingCard
                key={row.id}
                row={row}
                sourceLabel={sourceLabel.get(row.sourceId) ?? row.sourceId}
                busy={actions.busyId === row.id}
                onShortlist={(next) => void actions.setStatus(row.id, next ? "shortlisted" : "new")}
                onApplied={() => void actions.markApplied(row)}
                onDismiss={(reason, note) => void actions.setStatus(row.id, "dismissed", { reason, note })}
                onRestore={() => void actions.setStatus(row.id, "new")}
              />
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
      ) : rows && !loadError ? (
        <EmptyState state={emptyState} droppedByMin={droppedByMin ?? 0} scan={scan} />
      ) : null}
    </div>
  );
}

/** One panel per missing link of the chain, each with the ONE next step that fixes it. */
function EmptyState({ state, droppedByMin, scan }: { state: FeedEmptyState; droppedByMin: number; scan: ReturnType<typeof useScanTask> }) {
  const t = useTranslations("me.jobs.empty");
  if (state === "ok") return null;
  const cta =
    state === "no_profile" ? (
      <Link href="/me" className={`${BTN_PRIMARY} h-10 px-4`}>
        {t("no_profile.cta")}
      </Link>
    ) : state === "no_sources" ? (
      <Link href="/me/sources" className={`${BTN_PRIMARY} h-10 px-4`}>
        {t("no_sources.cta")}
      </Link>
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
