"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_ARENAS, type Gig, type GigArena, type GigAttempt, type GigKpi } from "@/app/_lib/gigs/types";
import {
  EXIT_STATUSES,
  foldNiches,
  LANE_STEPS,
  laneRows,
  NO_LANE,
  nicheBySpecialistMap,
  nicheCell,
  nicheTally,
  YOUR_STEPS,
  type AttemptTally,
  type FileStatus,
  type LaneCell,
  type LaneStep,
  type Niche,
} from "./deskLogic";
import { rateView, type SpecialistRow } from "./gigsLogic";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

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

const ARENA_KEY: Readonly<Record<GigArena, string>> = { freelance: "F", oss_bounty: "O", security: "S", competition: "C" };

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
  /** A niche key (deskLogic nicheKeyOf) to highlight and scroll into view, or null. */
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

      <p className="zkey">
        <span>
          <i className="mk ok" aria-hidden /> {t("lanes.keyLead")}
        </span>
        <span>
          <i className="mk fail" aria-hidden /> {t("lanes.keyFailed")}
        </span>
        <span>
          <span className="key-dot" aria-hidden>
            ·
          </span>{" "}
          {t("lanes.keyNoneNow")}
        </span>
        <span>
          <span className="key-slot" aria-hidden /> {t("lanes.keyNever")}
        </span>
      </p>

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

function StageCell({ cell, total, where, onOpen }: { cell: LaneCell; total: number; where: string; onOpen: () => void }) {
  const t = useTranslations("gigs");
  const now = YOUR_STEPS.has(cell.step);
  const cls = `cell${now ? " nowcol" : ""}`;
  if (cell.count > 0) {
    const share = total ? Math.round((cell.count / total) * 100) : 0;
    const sentence = t("lanes.cellCount", { where, count: cell.count, share, now: now ? "yes" : "no" });
    return (
      <Tooltip label={sentence} className="gd-tipcell">
        <button type="button" className={cls} aria-label={sentence} onClick={onOpen}>
          <span className="num">{cell.count}</span>
          <span className="bar" aria-hidden>
            <i style={{ width: `${Math.max(3, share)}%` }} />
          </span>
        </button>
      </Tooltip>
    );
  }
  let kind: "zero" | "stub" | "empty" | "never";
  if (cell.step === "sent") kind = "zero";
  else if (cell.step === "verdict") kind = "stub";
  else kind = cell.reached ? "empty" : "never";
  const sentence = t(`lanes.cell_${kind}`, { where });
  return (
    <Tooltip label={sentence} className="gd-tipcell">
      <span className={`${cls} ${kind}`} role="img" aria-label={sentence} tabIndex={0}>
        {kind === "zero" ? (
          <>
            <span className="num">0</span>
            <span className="bar" aria-hidden />
          </>
        ) : kind === "empty" ? (
          <span className="num">·</span>
        ) : (
          <span className="slot" aria-hidden>
            —
          </span>
        )}
      </span>
    </Tooltip>
  );
}

function NicheHead({ niche }: { niche: Niche }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const lead = niche.lead;
  const leadStatus = lead.hire ? fmt.hireStatus(lead.hire.status) : t("specialists.noHire");
  const earlierStates = [...new Set(niche.earlier.map((h) => (h.hire ? fmt.hireStatus(h.hire.status) : t("specialists.noHire")).toLowerCase()))].join(", ");
  return (
    <>
      <div className="nn">
        <span className="arena-key" role="img" aria-label={fmt.arena(niche.arena)}>
          {ARENA_KEY[niche.arena]}
        </span>
        {niche.label}
      </div>
      <div className="hire">
        {lead.hire?.status === "active" ? (
          <span className="ok">
            <i className="mk ok" aria-hidden /> {leadStatus}
          </span>
        ) : (
          <span>{leadStatus}</span>
        )}
        <span>{t("lanes.since", { date: fmt.date(lead.createdAt) })}</span>
      </div>
      {niche.earlier.length > 0 ? (
        <details className="fold-inline">
          <summary>{t("lanes.earlier", { count: niche.earlier.length, states: earlierStates })}</summary>
          <ul>
            {niche.hires.map((h) => (
              <li key={h.id}>
                {t("lanes.hireLine", {
                  name: h.name,
                  status: h.hire ? fmt.hireStatus(h.hire.status) : t("specialists.noHire"),
                  date: fmt.date(h.createdAt),
                })}
                {h.hire?.personaName ? ` · ${h.hire.personaName}` : null}
                {" · "}
                {h.registry === "available" ? t("specialists.fromRegistry") : t("specialists.fromSeed")}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="hire">{lead.registry === "available" ? t("specialists.fromRegistry") : t("specialists.fromSeed")}</p>
      )}
    </>
  );
}

function PoolHead({ onHire }: { onHire: () => void }) {
  const t = useTranslations("gigs");
  return (
    <>
      <div className="nn pool">
        <i className="mk none" aria-hidden /> {t("lanes.pool")}
      </div>
      <div className="hire">
        <span>{t("lanes.poolSub")}</span>
        <button type="button" className="linkbtn" onClick={onHire}>
          {t("lanes.hireOne")}
        </button>
      </div>
    </>
  );
}

function NicheRecord({ niche, tallies }: { niche: Niche; tallies: Readonly<Record<string, AttemptTally>> | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const tally = nicheTally(niche, tallies);
  const failed = tally.byStatus.failed ?? 0;
  const revised = tally.byStatus.revision_requested ?? 0;
  const share = tally.attempts ? Math.round((failed / tally.attempts) * 100) : 0;
  const spec = niche.lead.spec;
  return (
    <>
      <div className="failbar" role="cell">
        {tallies === null ? (
          <span className="t">{t("lanes.attemptsLoading")}</span>
        ) : tally.attempts === 0 ? (
          <span className="t">{t("lanes.noRuns")}</span>
        ) : (
          <>
            <span className="t">{t.rich("lanes.failedOf", { failed, attempts: tally.attempts, b: (c) => <b>{c}</b> })}</span>
            <span className="b" role="img" aria-label={t("lanes.failedShare", { share })}>
              <i style={{ width: `${share}%` }} />
            </span>
            <span className="t">{t("lanes.revised", { count: revised })}</span>
          </>
        )}
      </div>
      <div className="money" role="cell">
        {tallies === null || tally.attempts === 0 ? (
          <span className="l">—</span>
        ) : (
          <>
            <span className="num">{fmt.usd(tally.costUsd)}</span>
            <span className="l">{tally.costUnreported > 0 ? t("lanes.costUnreported", { count: tally.costUnreported }) : t("lanes.costAllReported")}</span>
          </>
        )}
        <span className="l">{t("specialists.budgetLine", { budget: fmt.usd(spec.budgetUsdPerAttempt) })}</span>
        <details className="fold-inline">
          <summary>{t("lanes.recipes", { count: spec.recipes.length })}</summary>
          <ul className="mono">
            {spec.recipes.map((r) => (
              <li key={r.slug}>{`${r.slug}@${r.version}`}</li>
            ))}
          </ul>
          <p className="hire">
            {t("specialists.connectors")}: {spec.connectors.length ? spec.connectors.join(", ") : t("specialists.noConnectors")}
          </p>
        </details>
      </div>
    </>
  );
}

function HireForm({ initialArena, onHired, onClose }: { initialArena: GigArena; onHired: () => Promise<unknown>; onClose: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [arena, setArena] = useState<GigArena>(initialArena);
  const [niche, setNiche] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function hire() {
    if (busy) return;
    if (!niche.trim()) {
      setError(t("specialists.nicheRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson("/api/gigs/specialists", "POST", { arena, niche: niche.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("specialists.hireFailed")));
      return;
    }
    setDone(res.body?.reused === true ? t("specialists.reused") : t("specialists.hired"));
    setNiche("");
    await onHired();
  }

  return (
    <form
      className="pop-panel stack-form hirepanel"
      aria-label={t("specialists.hireButton")}
      onSubmit={(e) => {
        e.preventDefault();
        void hire();
      }}
    >
      <div className="hireform">
        <label>
          <span>{t("specialists.arena")}</span>
          <select className="field" value={arena} onChange={(e) => setArena(e.target.value as GigArena)}>
            {GIG_ARENAS.map((a) => (
              <option key={a} value={a}>
                {fmt.arena(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("specialists.nicheLabel")}</span>
          <input className="field" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("specialists.nichePlaceholder")} maxLength={80} />
        </label>
        <div className="row-form">
          <button type="submit" className="btn primary" disabled={busy}>
            {t("lanes.hire")}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("lanes.close")}
          </button>
        </div>
      </div>
      <p className="quiet-line">{t("lanes.hireNote")}</p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="note-line">
          {done}
        </p>
      ) : null}
    </form>
  );
}
