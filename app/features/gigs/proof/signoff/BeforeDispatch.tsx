"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigKpi } from "@/app/_lib/gigs/types";
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
// Nobody worked it yet: dispatch it, or decline it
// ---------------------------------------------------------------------------

export function Triage({
  gig,
  source,
  specialist,
  kpi,
  onChanged,
  onDecline,
  onHire,
}: {
  gig: Gig;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  kpi: GigKpi | null;
  onChanged: AfterWrite;
  onDecline: () => void;
  onHire: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();

  async function dispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (body) await onChanged(t("triageView.dispatchedFlash", { name: specialist?.name ?? t("desk.theAgent") }));
  }

  return (
    <div className="acts">
      {specialist ? (
        <p className="hint">
          {t("signoff.goesTo", { name: specialist.name })} <RateLine cell={kpi?.bySpecialist[specialist.id]} compact />
        </p>
      ) : (
        <p className="hint">{t("signoff.noSpecialist")}</p>
      )}
      {source?.pausedReason ? <p className="alert">{t("triageView.sourcePaused", { reason: fmt.paused(source.pausedReason) })}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {gig.status === "qualified" ? (
        <button type="button" className="btn affirm block wrap" disabled={busy} onClick={() => void dispatch()}>
          {t("triageView.dispatch", { name: specialist?.name ?? t("triageView.itsSpecialist") })}
        </button>
      ) : (
        <p className="hint">
          <b>{t("triageView.belowBar")}.</b> {t("triageView.belowBarHow")}
        </p>
      )}
      {!specialist ? (
        <button type="button" className="btn block wrap" onClick={onHire}>
          {t("triageView.hireFor", { arena: fmt.arena(gig.arena) })}
        </button>
      ) : null}
      <button type="button" className="btn ghost danger block" disabled={busy} onClick={onDecline}>
        {t("triageView.decline")}
      </button>
    </div>
  );
}
