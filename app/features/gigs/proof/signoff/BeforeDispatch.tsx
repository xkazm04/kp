"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { personaModelLabel } from "../../logic/pairing";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { RateLine } from "../../shared/GigsMarks";
import { useGigsFormat } from "../../data/useGigsFormat";
import { useWrite } from "./useWrite";

// ---------------------------------------------------------------------------
// A quarantined listing: clear it (after reading it) or decline it - never dispatch
// ---------------------------------------------------------------------------

export function Suspect({ gig, onChanged, onDecline }: { gig: Gig; onChanged: AfterWrite; onDecline: () => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();
  const [read, setRead] = useState(false);

  async function clear() {
    const ok = await run(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "clear_suspect" });
    if (ok) await onChanged(t("work.clearedFlash"));
  }

  return (
    <div className="acts">
      <ul className="t-meta reasons">
        {gig.suspectReasons.map((r) => (
          <li key={r}>
            <b className="coral">{fmt.suspect(r)}</b>
          </li>
        ))}
      </ul>
      <p className="hint">
        <b>{t("suspectView.notDispatchable")}.</b> {t("suspectView.noControl")}
      </p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="btn primary block wrap" disabled={busy} onClick={onDecline}>
        {t("suspectView.decline")}
      </button>
      <label className="check-line">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
        {t("suspectView.readIt")}
      </label>
      <button type="button" className="btn block wrap" disabled={busy || !read} onClick={() => void clear()}>
        {t("suspectView.clear")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nobody worked it yet: dispatch it (once a plan is accepted), or decline it
// ---------------------------------------------------------------------------

/** Dispatch needs an accepted plan: "ok", none yet ("missing"), or the plans are still
 *  being read. A gig with an earlier attempt (worked before plans existed) is not gated. */
export type PlanGate = "ok" | "missing" | "loading";

export function Triage({
  gig,
  attempt,
  source,
  specialist,
  kpi,
  planGate,
  onChanged,
  onDecline,
  onOpenPlans,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  kpi: GigKpi | null;
  planGate: PlanGate;
  onChanged: AfterWrite;
  onDecline: () => void;
  onOpenPlans: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();
  const gate = attempt === null ? planGate : "ok";
  const name = specialist?.name ?? (attempt ? t("triageView.itsSpecialist") : t("pairing.itsOwnAgent"));

  async function dispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (!body) return;
    // 202 { pairing: "pending" }: the gig's own persona is being hired; it runs once approved.
    await onChanged(body.pairing === "pending" ? t("pairing.pendingFlash") : t("triageView.dispatchedFlash", { name }));
  }

  return (
    <div className="acts">
      {specialist ? (
        <p className="hint">
          {t("signoff.goesTo", { name: specialist.name })} <RateLine cell={kpi?.bySpecialist[specialist.id]} compact />
        </p>
      ) : attempt ? (
        <p className="hint">{t("signoff.noSpecialist")}</p>
      ) : (
        <p className="hint">{t("pairing.dispatchHint", { model: personaModelLabel() })}</p>
      )}
      {source?.pausedReason ? <p className="alert">{t("triageView.sourcePaused", { reason: fmt.paused(source.pausedReason) })}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {gig.status === "qualified" ? (
        <button type="button" className="btn affirm block wrap" disabled={busy || gate !== "ok"} aria-describedby={gate === "missing" ? `gate-${gig.id}` : undefined} onClick={() => void dispatch()}>
          {t("triageView.dispatch", { name })}
        </button>
      ) : (
        <p className="hint">
          <b>{t("triageView.belowBar")}.</b> {t("triageView.belowBarHow")}
        </p>
      )}
      {gig.status === "qualified" && gate === "missing" ? (
        <p className="hint" id={`gate-${gig.id}`}>
          <b>{t("plans.gateReason")}.</b> {t("plans.gateBody")}{" "}
          <button type="button" className="linkbtn" onClick={onOpenPlans}>
            {t("plans.openPlans")}
          </button>
        </p>
      ) : gig.status === "qualified" && gate === "loading" ? (
        <p className="hint" role="status">
          {t("plans.gateChecking")}
        </p>
      ) : null}
      <button type="button" className="btn ghost danger block" disabled={busy} onClick={onDecline}>
        {t("triageView.decline")}
      </button>
    </div>
  );
}
