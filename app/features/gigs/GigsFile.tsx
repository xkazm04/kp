"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { GIG_ARENAS, type Gig, type GigAttempt, type GigStatus } from "@/app/_lib/gigs/types";
import { fileRows, NO_LANE, statusMatches, type FileFilter, type FileSort, type FileStatus, type Niche } from "./deskLogic";
import type { SourceRow } from "./gigsLogic";
import type { ProofList } from "./GigsProof";
import { useGigsFormat } from "./useGigsFormat";

// The whole file (B/3): every gig the tab read, filtered by status and arena chips (each
// with its count), a lane opened from Lanes, and `/` search; sorted by recency, deadline,
// the scan's fit score, or reward WITHIN one currency (never converted, never compared
// across); fifty to a page. A row opens the gig's proof, and ← / → then walk this list in
// this order, across its pages.

const PER_PAGE = 50;

/** The chips always shown, in the order of the line; the rest appear when they hold gigs. */
const CORE: GigStatus[] = ["drafted", "in_review", "suspect", "qualified", "dispatched", "new"];
const REST: GigStatus[] = ["sent", "accepted", "rejected", "declined", "expired", "withdrawn"];

const MARK: Partial<Record<GigStatus, string>> = {
  drafted: "you",
  in_review: "you",
  suspect: "quar",
  qualified: "qualified",
  dispatched: "agent",
  new: "new",
  sent: "judge",
  accepted: "done",
  rejected: "off",
  declined: "off",
  expired: "off",
  withdrawn: "off",
};

export function GigsFile({
  gigs,
  attemptsByGig,
  sources,
  nicheMap,
  niches,
  truncated,
  now,
  filter,
  onFilter,
  page,
  onPage,
  searchRef,
  lastOpened,
  onOpen,
  onToWires,
  reward,
  deadline,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  sources: readonly SourceRow[];
  nicheMap: ReadonlyMap<string, string>;
  niches: readonly Niche[];
  truncated: boolean;
  now: Date;
  filter: FileFilter;
  onFilter: (f: FileFilter) => void;
  page: number;
  onPage: (p: number) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  lastOpened: string | null;
  onOpen: (gigId: string, list: ProofList) => void;
  onToWires: () => void;
  reward: (g: Gig, withCurrency: boolean) => ReactNode;
  deadline: (g: Gig, words?: boolean) => ReactNode;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const rows = useMemo(() => fileRows(gigs, attemptsByGig, filter, nicheMap, now), [gigs, attemptsByGig, filter, nicheMap, now]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of gigs) c[g.status] = (c[g.status] ?? 0) + 1;
    return c;
  }, [gigs]);
  const arenaCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of gigs) c[g.arena] = (c[g.arena] ?? 0) + 1;
    return c;
  }, [gigs]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const slice = rows.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);
  const ids = rows.map((g) => g.id);

  const statusLabel = (s: FileStatus) =>
    s === "in_review" ? t("front.col.ready") : s === "drafted" ? t("front.col.proof") : s === "suspect" ? t("front.col.quar") : s === "verdict" ? t("file.verdict") : s === "exit" ? t("file.exit") : s === "all" ? t("file.all") : fmt.status(s);
  const laneLabel = filter.lane === null ? null : filter.lane === NO_LANE ? t("file.noLane") : (niches.find((n) => n.key === filter.lane)?.label ?? filter.lane);
  const listLabel = [laneLabel, filter.status !== "all" ? statusLabel(filter.status) : null, filter.arena !== "all" ? fmt.arena(filter.arena) : null].filter(Boolean).join(" · ") || t("file.title");

  const set = (patch: Partial<FileFilter>) => onFilter({ ...filter, ...patch });
  const sortBy = (s: FileSort) => set(filter.sort === s && s !== "touched" ? { dir: filter.dir === 1 ? -1 : 1 } : { sort: s, dir: 1 });
  const statuses: FileStatus[] = ["all", ...CORE, ...REST.filter((s) => (counts[s] ?? 0) > 0)];
  if ((filter.status === "verdict" || filter.status === "exit") && !statuses.includes(filter.status)) statuses.push(filter.status);
  const countOf = (s: FileStatus) => (s === "all" ? gigs.length : gigs.filter((g) => statusMatches(s, g.status)).length);

  const sortHead = (s: FileSort, label: string, right = false) => {
    const on = filter.sort === s;
    // Deadline reads soonest first; recency, reward and fit read largest first.
    const natural = s === "deadline" ? "ascending" : "descending";
    const dirWord = filter.dir === 1 ? natural : natural === "ascending" ? "descending" : "ascending";
    return (
      <th scope="col" className={right ? "r" : undefined} aria-sort={on ? dirWord : undefined}>
        <button type="button" onClick={() => sortBy(s)}>
          {label} <span aria-hidden>{on ? (dirWord === "ascending" ? "↑" : "↓") : ""}</span>
        </button>
      </th>
    );
  };

  return (
    <section id="gd-file" aria-labelledby="gd-file-h" className="scroll-mt-4">
      <div className="file-head">
        <h2 className="t-h2" id="gd-file-h">
          {t("file.title")}
        </h2>
        <span className="t-meta" role="status">
          {t("file.count", { shown: rows.length, total: gigs.length })}
          {truncated ? ` · ${t("file.truncated")}` : null}
        </span>
        <label className="search">
          <span className="sr-only">{t("file.search")}</span>
          <input
            ref={searchRef}
            type="search"
            value={filter.search}
            placeholder={t("file.search")}
            autoComplete="off"
            aria-keyshortcuts="/"
            onChange={(e) => set({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
          <kbd aria-hidden>/</kbd>
        </label>
      </div>

      <div className="filters">
        <div className="line" role="group" aria-label={t("file.statusLabel")}>
          <span className="lbl caps">{t("file.statusLabel")}</span>
          {statuses.map((s) => (
            <button key={s} type="button" className={`chip${s === "drafted" || s === "in_review" || s === "suspect" ? " needs" : ""}`} aria-pressed={filter.status === s} onClick={() => set({ status: s })}>
              {statusLabel(s)} <b>{fmt.number(countOf(s))}</b>
            </button>
          ))}
          {laneLabel ? (
            <button type="button" className="chip" aria-pressed onClick={() => set({ lane: null })} aria-label={t("file.laneClear", { lane: laneLabel })}>
              {t("file.lane", { lane: laneLabel })} <b aria-hidden>×</b>
            </button>
          ) : null}
        </div>
        <div className="line" role="group" aria-label={t("file.arenaLabel")}>
          <span className="lbl caps">{t("file.arenaLabel")}</span>
          <button type="button" className="chip" aria-pressed={filter.arena === "all"} onClick={() => set({ arena: "all" })}>
            {t("file.all")}
          </button>
          {GIG_ARENAS.map((a) => {
            const n = arenaCounts[a] ?? 0;
            const src = sources.filter((s) => s.arena === a);
            if (n === 0 && src.length > 0 && src.every((s) => s.lastRunAt === null)) {
              return (
                <Tooltip key={a} label={t("file.neverRun", { arena: fmt.arena(a) })}>
                  <button type="button" className="chip dashed" aria-label={t("file.neverRun", { arena: fmt.arena(a) })} onClick={onToWires}>
                    {fmt.arena(a)} <b>—</b>
                  </button>
                </Tooltip>
              );
            }
            return (
              <button key={a} type="button" className="chip" aria-pressed={filter.arena === a} onClick={() => set({ arena: a })}>
                {fmt.arena(a)} <b>{fmt.number(n)}</b>
              </button>
            );
          })}
        </div>
      </div>

      <div className="file-wrap">
        <table className="file">
          <colgroup>
            <col className="c-status" />
            <col />
            <col className="c-arena" />
            <col className="c-reward" />
            <col className="c-deadline" />
            <col className="c-fit" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t("file.colStatus")}</th>
              {sortHead("touched", t("file.colListing"))}
              <th scope="col">{t("file.colArena")}</th>
              {sortHead("reward", t("file.colReward"), true)}
              {sortHead("deadline", t("file.colDeadline"))}
              {sortHead("fit", t("file.colFit"), true)}
            </tr>
          </thead>
          <tbody>
            {slice.length ? (
              slice.map((g) => (
                <tr key={g.id} className={g.id === lastOpened ? "current" : undefined}>
                  <td>
                    <span className={`st ${MARK[g.status] ?? "new"}`}>
                      <i aria-hidden />
                      {statusLabel(g.status)}
                    </span>
                  </td>
                  <td className="title">
                    <button type="button" onClick={() => onOpen(g.id, { ids, label: listLabel })}>
                      {g.title}
                    </button>
                    {g.org ? <span className="org">{g.org}</span> : null}
                  </td>
                  <td>{fmt.arena(g.arena)}</td>
                  <td className="r">{reward(g, true)}</td>
                  <td>{deadline(g)}</td>
                  <td className="r">{g.qualification ? g.qualification.score : <span className="absent" aria-label={t("file.notScored")}>—</span>}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="q-empty">
                  {t("file.none")}{" "}
                  <button type="button" className="linkbtn" onClick={() => onFilter({ ...filter, status: "all", arena: "all", lane: null, search: "" })}>
                    {t("file.clear")}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav className="pager" aria-label={t("file.pages")}>
        <span className="of t-meta">
          {rows.length ? t("file.range", { from: at * PER_PAGE + 1, to: Math.min(rows.length, at * PER_PAGE + PER_PAGE), total: rows.length }) : t("file.count", { shown: 0, total: gigs.length })}
        </span>
        <button type="button" disabled={at === 0} onClick={() => onPage(at - 1)}>
          {t("file.prev")}
        </button>
        {pageNumbers(at, pages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="dim" aria-hidden>
              …
            </span>
          ) : (
            <button key={p} type="button" aria-current={p === at ? "page" : undefined} onClick={() => onPage(p)}>
              {p + 1}
            </button>
          )
        )}
        <button type="button" disabled={at >= pages - 1} onClick={() => onPage(at + 1)}>
          {t("file.next")}
        </button>
      </nav>
    </section>
  );
}

/** 1 … p-1 p p+1 … last, zero-based; null marks a gap. */
function pageNumbers(at: number, pages: number): (number | null)[] {
  const keep = [...new Set([0, pages - 1, at - 1, at, at + 1].filter((p) => p >= 0 && p < pages))].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let last = -1;
  for (const p of keep) {
    if (p - last > 1) out.push(null);
    out.push(p);
    last = p;
  }
  return out;
}
