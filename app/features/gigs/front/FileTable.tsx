"use client";

import { useTranslations } from "next-intl";
import type { Gig, GigStatus } from "@/app/_lib/gigs/types";
import type { FileFilter, FileSort, FileStatus } from "../logic/file";
import type { ProofList } from "../proof/GigsProof";
import { useGigsFormat } from "../data/useGigsFormat";
import type { DeadlineCell, RewardCell } from "./useGigCells";

// The whole file's table (GigsFile.tsx): one page of rows, the sortable heads saying their
// direction in `aria-sort`, and an empty page that offers to clear the filters.

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

export function FileTable({
  slice,
  ids,
  listLabel,
  filter,
  set,
  onFilter,
  statusLabel,
  lastOpened,
  onOpen,
  reward,
  deadline,
}: {
  slice: readonly Gig[];
  ids: string[];
  listLabel: string;
  filter: FileFilter;
  set: (patch: Partial<FileFilter>) => void;
  onFilter: (f: FileFilter) => void;
  statusLabel: (s: FileStatus) => string;
  lastOpened: string | null;
  onOpen: (gigId: string, list: ProofList) => void;
  reward: RewardCell;
  deadline: DeadlineCell;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const sortBy = (s: FileSort) => set(filter.sort === s && s !== "touched" ? { dir: filter.dir === 1 ? -1 : 1 } : { sort: s, dir: 1 });

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
  );
}
