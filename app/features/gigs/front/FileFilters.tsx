"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { GIG_ARENAS, type Gig, type GigStatus } from "@/app/_lib/gigs/types";
import { type FileFilter, type FileStatus, statusMatches } from "../logic/file";
import type { SourceRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";

// The whole file's chips (GigsFile.tsx): status, each with its count, a lane opened from
// Lanes (cleared by its ×), and arena. An arena whose wires never ran reads "—" and leads to
// the Wires page, never a measured 0.

/** The chips always shown, in the order of the line; the rest appear when they hold gigs. */
const CORE: GigStatus[] = ["drafted", "in_review", "suspect", "qualified", "dispatched", "new"];
const REST: GigStatus[] = ["sent", "accepted", "rejected", "declined", "expired", "withdrawn"];

export function FileFilters({
  gigs,
  sources,
  filter,
  set,
  laneLabel,
  statusLabel,
  onToWires,
}: {
  gigs: readonly Gig[];
  sources: readonly SourceRow[];
  filter: FileFilter;
  set: (patch: Partial<FileFilter>) => void;
  laneLabel: string | null;
  statusLabel: (s: FileStatus) => string;
  onToWires: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
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

  const statuses: FileStatus[] = ["all", ...CORE, ...REST.filter((s) => (counts[s] ?? 0) > 0)];
  if ((filter.status === "verdict" || filter.status === "exit") && !statuses.includes(filter.status)) statuses.push(filter.status);
  const countOf = (s: FileStatus) => (s === "all" ? gigs.length : gigs.filter((g) => statusMatches(s, g.status)).length);

  return (
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
  );
}
