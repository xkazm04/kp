"use client";

import { useMemo, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { type FileFilter, fileRows, type FileStatus } from "../logic/file";
import { type Niche, NO_LANE } from "../logic/niches";
import type { SourceRow } from "../logic/wire";
import type { ProofList } from "../proof/GigsProof";
import { useGigsFormat } from "../data/useGigsFormat";
import { FileFilters } from "./FileFilters";
import { FilePager, PER_PAGE } from "./FilePager";
import { FileTable } from "./FileTable";
import type { DeadlineCell, RewardCell } from "./useGigCells";

// The whole file (B/3): every gig the tab read, filtered by status and arena chips (each
// with its count), a lane opened from Lanes, and `/` search; sorted by recency, deadline,
// the scan's fit score, or reward WITHIN one currency (never converted, never compared
// across); fifty to a page. A row opens the gig's proof, and ← / → then walk this list in
// this order, across its pages.
//
// Parts: FileFilters.tsx (the chips), FileTable.tsx (the sortable table), FilePager.tsx.

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
  reward: RewardCell;
  deadline: DeadlineCell;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const rows = useMemo(() => fileRows(gigs, attemptsByGig, filter, nicheMap, now), [gigs, attemptsByGig, filter, nicheMap, now]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const slice = rows.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);
  const ids = rows.map((g) => g.id);

  const statusLabel = (s: FileStatus) =>
    s === "in_review" ? t("front.col.ready") : s === "drafted" ? t("front.col.proof") : s === "suspect" ? t("front.col.quar") : s === "verdict" ? t("file.verdict") : s === "exit" ? t("file.exit") : s === "all" ? t("file.all") : fmt.status(s);
  const laneLabel = filter.lane === null ? null : filter.lane === NO_LANE ? t("file.noLane") : (niches.find((n) => n.key === filter.lane)?.label ?? filter.lane);
  const listLabel = [laneLabel, filter.status !== "all" ? statusLabel(filter.status) : null, filter.arena !== "all" ? fmt.arena(filter.arena) : null].filter(Boolean).join(" · ") || t("file.title");

  const set = (patch: Partial<FileFilter>) => onFilter({ ...filter, ...patch });

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

      <FileFilters gigs={gigs} sources={sources} filter={filter} set={set} laneLabel={laneLabel} statusLabel={statusLabel} onToWires={onToWires} />

      <FileTable
        slice={slice}
        ids={ids}
        listLabel={listLabel}
        filter={filter}
        set={set}
        onFilter={onFilter}
        statusLabel={statusLabel}
        lastOpened={lastOpened}
        onOpen={onOpen}
        reward={reward}
        deadline={deadline}
      />

      <FilePager at={at} pages={pages} shown={rows.length} total={gigs.length} onPage={onPage} />
    </section>
  );
}
