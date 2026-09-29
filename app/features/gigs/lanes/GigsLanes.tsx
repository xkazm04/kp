"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import type { FileStatus } from "../logic/file";
import { EXIT_STATUSES, LANE_STEPS, laneRows, type LaneStep } from "../logic/lanes";
import { type AttemptTally, foldNiches, nicheBySpecialistMap, nicheCell, NO_LANE } from "../logic/niches";
import { rateView } from "../logic/rate";
import type { SpecialistRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";
import { HireForm } from "./HireForm";
import { LaneKey, NicheRecord, StageCell } from "./LaneCells";
import { NicheHead, PoolHead } from "./LaneHeads";

// Lanes - the specialists as the niches they are (docs/features/gigs/README.md "The Gigs
// tab"), B/2's lanes page from the gigs-calm contest: one row per niche (the same niche
// hired twice or three times is ONE lane, its working hire leading, the earlier copies
// folded under it), the lifecycle as eight stage cells, then the niche's attempt record
// (failed share, revisions) and its reported cost. The unrouted pool closes the list and
// the ways off the line sit in an exit row below it.
//
// A cell is a door, not a list: it opens the front page's whole file filtered to that lane
// and stage (the shell's `onOpenCell`), so there is one list surface in the tab. Every cell
// says what it is in a sentence that is BOTH its accessible name and its tooltip - "none
// here now" (the lane reached the stage and moved on) and "never reached" never look alike,
// Sent 0 is a measured zero and Verdict 0 is unmeasured.
//
// Parts: LaneHeads.tsx (a row's niche or pool head), LaneCells.tsx (the key, the stage
// cells, a niche's attempt record and cost), HireForm.tsx (hire a specialist).

/** A lane step as the file filters it: the two verdicts share one column. */
function fileStatusOf(step: LaneStep): FileStatus {
  return step === "verdict" ? "verdict" : step;
}

export function GigsLanes({
  gigs,
  attemptsByGig,
  specialists,
  tallies,
  kpi,
  focusLane,
  hireArena,
  onOpenCell,
  onHired,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  specialists: readonly SpecialistRow[];
  tallies: Readonly<Record<string, AttemptTally>> | null;
  kpi: GigKpi | null;
  /** A niche key (logic/niches nicheKeyOf) to highlight and scroll into view, or null. */
  focusLane: string | null;
  /** Open the hire form on this arena (from a proof's "hire one"), or null. */
  hireArena: GigArena | null;
  /** A stage cell (or the exit row) was pressed. `lane` is a niche key, NO_LANE for the
   *  unrouted pool, or "" for every lane (the exit row) - the shell maps "" to a null lane
   *  filter. `label` names the list for the proof trail. */
  onOpenCell: (lane: string, status: FileStatus, label: string) => void;
  /** After a hire: re-read the specialists. */
  onHired: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const niches = useMemo(() => foldNiches(specialists), [specialists]);
  const bySpecialist = useMemo(() => nicheBySpecialistMap(niches), [niches]);
  const rows = useMemo(() => laneRows(gigs, attemptsByGig, niches, bySpecialist), [gigs, attemptsByGig, niches, bySpecialist]);
  const [hireOpen, setHireOpen] = useState<GigArena | null>(hireArena ?? (specialists.length === 0 ? "freelance" : null));
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusLane]);

  const colTotals = useMemo(() => {
    const out: Partial<Record<LaneStep, number>> = {};
    for (const r of rows) for (const c of r.cells) out[c.step] = (out[c.step] ?? 0) + c.count;
    return out;
  }, [rows]);
  const exitTotal = rows.reduce((n, r) => n + r.exit, 0);
  const earlier = niches.reduce((n, x) => n + x.earlier.length, 0);
  const atWork = niches.filter((n) => n.lead.hire?.status === "active").length;
  const measured = niches.filter((n) => rateView(nicheCell(n, kpi)).measured).length;
  const stepLabel = (s: LaneStep) => t(`lanes.step.${s}`);
  const nicheByKey = new Map(niches.map((n) => [n.key, n]));

  return (
    <div className="enter">
      <header className="page-head">
        <span className="caps dim">{t("lanes.eyebrow")}</span>
        <div className="row">
          <h1 className="t-display">{t("lanes.headline", { niches: niches.length, hires: specialists.length })}</h1>
          <button type="button" className="btn" aria-expanded={hireOpen !== null} onClick={() => setHireOpen((a) => (a ? null : "freelance"))}>
            {t("specialists.hireButton")}
          </button>
        </div>
        <p className="deck">
          {t("lanes.deckAtWork", { count: atWork })}
          <span className="sep">·</span>
          {t("lanes.deckEarlier", { count: earlier })}
          <span className="sep">·</span>
          {measured === 0 ? t("lanes.deckUnmeasured") : t("lanes.deckMeasured", { count: measured })}
        </p>
      </header>

      {hireOpen ? <HireForm key={hireOpen} initialArena={hireOpen} onHired={onHired} onClose={() => setHireOpen(null)} /> : null}

      <LaneKey />

      {specialists.length === 0 ? <p className="note-line">{t("lanes.empty")}</p> : null}

      <div className="lanes">
        <div className="lanes-in" role="table" aria-label={t("lanes.tableLabel")}>
          <div className="nichegrid th" role="row">
            <span role="columnheader">{t("lanes.colNiche")}</span>
            <div className="mini heads" role="presentation">
              {LANE_STEPS.map((s) => (
                <span key={s} role="columnheader">
                  {stepLabel(s)}
                </span>
              ))}
            </div>
            <span role="columnheader">{t("lanes.colAttempts")}</span>
            <span role="columnheader">{t("lanes.colCost")}</span>
          </div>

          {rows.map((row) => {
            const niche = row.key === NO_LANE ? null : (nicheByKey.get(row.key) ?? null);
            const name = niche ? niche.label : t("lanes.pool");
            const focused = row.key === focusLane;
            return (
              <div key={row.key} ref={focused ? focusRef : undefined} className={`trow${focused ? " focus" : ""}`} role="row" aria-current={focused ? "true" : undefined}>
                <div className="nichegrid">
                  <div role="rowheader">{niche ? <NicheHead niche={niche} /> : <PoolHead onHire={() => setHireOpen("freelance")} />}</div>
                  <div className="mini" role="group" aria-label={t("lanes.byStage", { name })}>
                    {row.cells.map((c) => (
                      <StageCell
                        key={c.step}
                        cell={c}
                        total={colTotals[c.step] ?? 0}
                        where={`${name} · ${stepLabel(c.step)}`}
                        onOpen={() => onOpenCell(row.key, fileStatusOf(c.step), `${name} · ${stepLabel(c.step)}`)}
                      />
                    ))}
                  </div>
                  {niche ? <NicheRecord niche={niche} tallies={tallies} /> : (
                    <>
                      <span className="dim" role="cell">—</span>
                      <span className="dim" role="cell">—</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          <div className="exitrow" role="row">
            <span className="caps dim" role="rowheader">
              {t("lanes.exit")}
            </span>
            <span role="cell">
              <button type="button" className="exitcell" disabled={exitTotal === 0} onClick={() => onOpenCell("", "exit", t("lanes.exit"))}>
                <span className="num">{exitTotal}</span>
                {t("lanes.exitLine", { statuses: EXIT_STATUSES.map((s) => fmt.status(s).toLowerCase()).join(", ") })}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
