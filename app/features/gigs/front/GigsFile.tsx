"use client";

import { useMemo, type RefObject } from "react";
import { useTranslations } from "next-intl";
import type { Gig } from "@/app/_lib/gigs/types";
import { EMPTY_FILE, type FileFilter, fileRows, type FileStatus } from "../logic/file";
import { fileFacets, hiddenByStatus } from "../logic/fileFacets";
import { isGigType } from "@/app/_lib/gigs/gig-type";
import type { AfterWrite, SourceRow } from "../logic/wire";
import type { ProofList } from "../proof/GigsProof";
import { useGigsFormat } from "../data/useGigsFormat";
import { FileFilters } from "./FileFilters";
import { FilePager, PER_PAGE } from "./FilePager";
import { FileTable } from "./FileTable";
import type { DeadlineCell, RewardCell } from "./useGigCells";

// The whole file (B/3): every gig the tab read, filtered by three faceted dropdowns (status,
// arena, type; each option counted over what the other filters let through, logic/fileFacets.ts)
// and `/` search. The status defaults to "Active": the closed states (declined, withdrawn,
// expired, rejected, and an unsent gig past its deadline) stay out until picked, and the count
// line says how many that hides. Sorted by recency, deadline, the scan's fit score, or reward by
// its US-dollar value across currencies (the scan day's rate, logic/file.ts rewardUsd; a reward
// with no dollar value sorts last); fifty to a page. A row opens the gig's proof, and ← / → then
// walk this list in this order, across its pages.
//
// Parts: FileFilters.tsx (the dropdown row), FileTable.tsx (the sortable table), FilePager.tsx.

export function GigsFile({
  gigs,
  sources,
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
  onChanged,
  reward,
  deadline,
}: {
  gigs: readonly Gig[];
  sources: readonly SourceRow[];
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
  /** After a row's Accept (the accept loop): re-read and say what was queued. */
  onChanged: AfterWrite;
  reward: RewardCell;
  deadline: DeadlineCell;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const rows = useMemo(() => fileRows(gigs, filter, now), [gigs, filter, now]);
  const facets = useMemo(() => fileFacets(gigs, filter, now), [gigs, filter, now]);
  // Only the default status hides anything; say how many, and offer them.
  const hidden = filter.status === EMPTY_FILE.status ? hiddenByStatus(facets) : 0;
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const slice = rows.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);
  const ids = rows.map((g) => g.id);

  const statusLabel = (s: FileStatus) =>
    s === "in_review" ? t("front.col.ready")
    : s === "drafted" ? t("front.col.proof")
    : s === "suspect" ? t("front.col.quar")
    : s === "verdict" ? t("file.verdict")
    : s === "exit" ? t("file.exit")
    : s === "all" ? t("file.all")
    : s === "active" ? t("file.active")
    : s === "overdue" ? t("file.overdue")
    : fmt.status(s);
  const laneName = (lane: string) => (isGigType(lane) ? t(`lanes.type.${lane}`) : lane);
  const laneLabel = filter.lane === null ? null : laneName(filter.lane);
  const listLabel = [laneLabel, filter.status !== EMPTY_FILE.status ? statusLabel(filter.status) : null, filter.arena !== "all" ? fmt.arena(filter.arena) : null].filter(Boolean).join(" · ") || t("file.title");

  const set = (patch: Partial<FileFilter>) => onFilter({ ...filter, ...patch });

  return (
    <section id="gd-file" aria-labelledby="gd-file-h" className="scroll-mt-4">
      <div className="file-head">
        <h2 className="t-h2" id="gd-file-h">
          {t("file.title")}
        </h2>
        <span className="t-meta" role="status">
          {t("file.count", { shown: rows.length, total: gigs.length })}
          {hidden > 0 ? ` · ${t("file.hidden", { count: hidden })}` : null}
          {truncated ? ` · ${t("file.truncated")}` : null}
        </span>
        {hidden > 0 ? (
          <button type="button" className="linkbtn t-meta" onClick={() => set({ status: "all" })}>
            {t("file.showHidden")}
          </button>
        ) : null}
      </div>

      <FileFilters gigs={gigs} sources={sources} facets={facets} filter={filter} set={set} statusLabel={statusLabel} laneName={laneName} searchRef={searchRef} onToWires={onToWires} />

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
        onChanged={onChanged}
        reward={reward}
        deadline={deadline}
      />

      <FilePager at={at} pages={pages} shown={rows.length} total={gigs.length} onPage={onPage} />
    </section>
  );
}
