"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { GIG_OUTCOME_VERDICTS, type Gig, type GigAttempt, type GigKpi, type GigOutcomeVerdict } from "@/app/_lib/gigs/types";
import { overallCell } from "../../logic/rate";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { OutcomeMark, RateLine } from "../../shared/GigsMarks";
import { useGigsFormat } from "../../data/useGigsFormat";
import { useWrite } from "./useWrite";

// ---------------------------------------------------------------------------
// Sent: record the outside verdict
// ---------------------------------------------------------------------------

export function RecordVerdict({
  gig,
  attempt,
  source,
  specialist,
  kpi,
  now,
  onChanged,
  onFlash,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  kpi: GigKpi | null;
  now: Date;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const uid = useId().replace(/:/g, "");
  const { busy, error, run } = useWrite();
  const [verdict, setVerdict] = useState<GigOutcomeVerdict | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(gig.reward?.currency ?? "");
  const [words, setWords] = useState("");
  const [amountError, setAmountError] = useState(false);

  async function record() {
    if (!verdict) return;
    const trimmed = amount.trim().replace(",", ".");
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    const before = kpi ? overallCell(kpi) : null;
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/outcome`, "POST", {
      verdict,
      amount: verdict === "accepted" ? parsed : null,
      currency: verdict === "accepted" && parsed !== null && currency.trim() ? currency.trim().toUpperCase() : null,
      feedbackText: words.trim() || null,
      attemptId: attempt?.id ?? null,
    });
    if (!body) return;
    // The rate re-derives from the server's own fold, never a local guess.
    const next = await onChanged(null);
    const after = next ? overallCell(next) : null;
    const parts = [t("recordView.recordedFlash", { verdict: fmt.verdict(verdict) })];
    if (before && after) parts.push(t("recordView.rateMoved", { a0: before.accepted, r0: before.resolved, a1: after.accepted, r1: after.resolved, p0: before.pending, p1: after.pending }));
    if (body.sourcePaused === true) parts.push(t("recordView.sourcePaused", { host: source?.host ?? t("facts.forwarded") }));
    onFlash(parts.join(" "));
  }

  return (
    <>
      <div className="acts">
        <p className="hint">{t("recordView.pendingNote", { waited: fmt.relative(attempt?.sentAt ?? null, now) ?? t("recordView.unknownWait") })}</p>
        {specialist ? (
          <p className="hint">
            {t("recordView.specialistRecord", { name: specialist.name })} <RateLine cell={kpi?.bySpecialist[specialist.id]} compact />
          </p>
        ) : null}
      </div>
      <div className="stack-form">
        <span className="caps dim">{t("recordView.recordTitle")}</span>
        <div role="radiogroup" aria-label={t("recordView.verdictLabel")} className="verdicts">
          {GIG_OUTCOME_VERDICTS.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={verdict === v} onClick={() => setVerdict(v)}>
              <OutcomeMark kind={v} />
              {fmt.verdict(v)}
            </button>
          ))}
        </div>
        {verdict === "no_response" ? <p className="hint t-meta">{t("recordView.noResponseNote")}</p> : null}
        {verdict === "duplicate" ? <p className="hint t-meta">{t("recordView.duplicateNote")}</p> : null}
        {verdict === "accepted" ? (
          <>
            <div className="row-form">
              <label className="grow">
                <span>{t("recordView.amount")}</span>
                <input className="field" inputMode="decimal" value={amount} aria-invalid={amountError} placeholder={t("recordView.amountPlaceholder")} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="narrow">
                <span>{t("recordView.currency")}</span>
                <input className="field" value={currency} maxLength={16} onChange={(e) => setCurrency(e.target.value)} />
              </label>
            </div>
            <p className="t-meta">{t("recordView.ownCurrency")}</p>
            {amountError ? (
              <p role="alert" className="alert">
                {t("recordView.amountInvalid")}
              </p>
            ) : null}
          </>
        ) : null}
        <label htmlFor={`${uid}-words`}>
          <span>{t("recordView.wordsLabel")}</span>
        </label>
        <textarea id={`${uid}-words`} className="field" value={words} onChange={(e) => setWords(e.target.value)} placeholder={t("recordView.wordsHint")} />
        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn primary block" disabled={busy || !verdict} onClick={() => void record()}>
          {t("recordView.record")}
        </button>
      </div>
    </>
  );
}
