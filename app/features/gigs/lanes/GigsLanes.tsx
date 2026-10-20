"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import type { FileStatus } from "../logic/file";
import { EXIT_STATUSES, LANE_STEPS, laneRows, personasByType, type LaneStep } from "../logic/lanes";
import type { AttemptTally } from "../logic/niches";
import type { SpecialistRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";
import { LaneKey, StageCell, TypeRecord } from "./LaneCells";
import { TypeHead } from "./LaneHeads";

// Lanes - the gigs by the KIND of work they are (docs/features/gigs/README.md "The Gigs
// tab"), B/2's lanes page from the gigs-calm contest regrouped by gig type (gig-mastery S2:
// every gig is paired with its own persona, so the niche specialist that once held a gig is
// no longer what a row shares). One row per type (app/_lib/gigs/gig-type.ts), the lifecycle
// as eight stage cells, then the record of that type's gig agents (failed share, revisions)
// and their reported cost. The ways off the line sit in an exit row below.
//
// A cell is a door, not a list: it opens the front page's whole file filtered to that type
// and stage (the shell's `onOpenCell`), so there is one list surface in the tab. Every cell
// says what it is in a sentence that is BOTH its accessible name and its tooltip - "none
// here now" (the lane reached the stage and moved on) and "never reached" never look alike,
// Sent 0 is a measured zero and Verdict 0 is unmeasured.
//
// Nobody is hired here: a gig's persona is created when its accepted plan is dispatched.
// Parts: LaneHeads.tsx (a row's type head), LaneCells.tsx (the key, the stage cells, a
// type's agent record and cost).

/** A lane step as the file filters it: the two verdicts share one column. */
function fileStatusOf(step: LaneStep): FileStatus {
  return step === "verdict" ? "verdict" : step;
}

export function GigsLanes({
  gigs,
  attemptsByGig,
  specialists,
  tallies,
  focusLane,
  onOpenCell,
}: {
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  specialists: readonly SpecialistRow[];
  tallies: Readonly<Record<string, AttemptTally>> | null;
  /** A gig type to highlight and scroll into view, or null. */
  focusLane: string | null;
  /** A stage cell (or the exit row) was pressed. `lane` is a gig type, or "" for every
   *  lane (the exit row) - the shell maps "" to a null lane filter. `label` names the list
   *  for the proof trail. */
  onOpenCell: (lane: string, status: FileStatus, label: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const rows = useMemo(() => laneRows(gigs, attemptsByGig), [gigs, attemptsByGig]);
  const personas = useMemo(() => personasByType(gigs, specialists), [gigs, specialists]);
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
  const typesInUse = rows.filter((r) => r.total > 0).length;
  const gigAgents = specialists.filter((s) => s.gigId !== null);
  const atWork = gigAgents.filter((s) => s.hire?.status === "active").length;
  const legacy = specialists.filter((s) => s.gigId === null && s.hire?.status !== "retired").length;
  const stepLabel = (s: LaneStep) => t(`lanes.step.${s}`);

  return (
    <div className="enter">
      <header className="page-head">
        <span className="caps dim">{t("lanes.eyebrow")}</span>
        <h1 className="t-display">{t("lanes.headline", { gigs: gigs.length, types: typesInUse })}</h1>
        <p className="deck">
          {t("lanes.deckAtWork", { count: atWork })}
          <span className="sep">·</span>
          {t("lanes.deckPaired", { count: gigAgents.length })}
          <span className="sep">·</span>
          {t("lanes.deckLegacy", { count: legacy })}
        </p>
      </header>

      <LaneKey />

      {gigs.length === 0 ? <p className="note-line">{t("lanes.empty")}</p> : null}

      <div className="lanes">
        <div className="lanes-in" role="table" aria-label={t("lanes.tableLabel")}>
          <div className="nichegrid th" role="row">
            <span role="columnheader">{t("lanes.colType")}</span>
            <div className="mini heads" role="presentation">
              {LANE_STEPS.map((s) => (
                <span key={s} role="columnheader">
                  {stepLabel(s)}
                </span>
              ))}
            </div>
            <span role="columnheader">{t("lanes.colRuns")}</span>
            <span role="columnheader">{t("lanes.colCost")}</span>
          </div>

          {rows.map((row) => {
            const name = t(`lanes.type.${row.key}`);
            const focused = row.key === focusLane;
            return (
              <div key={row.key} ref={focused ? focusRef : undefined} className={`trow${focused ? " focus" : ""}`} role="row" aria-current={focused ? "true" : undefined}>
                <div className="nichegrid">
                  <div role="rowheader">
                    <TypeHead name={name} gigs={row.total} personas={personas[row.key]} />
                  </div>
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
                  <TypeRecord personas={personas[row.key]} tallies={tallies} />
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
      <p className="t-meta lanes-note">{t("lanes.recordNote")}</p>
    </div>
  );
}
