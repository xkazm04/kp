"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_AFFIRM, BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { GIG_OUTCOME_VERDICTS, type GigArena, type GigOutcomeVerdict } from "@/app/_lib/gigs/types";
import { overallCell, QUALIFY_BAR, type AfterWrite, type QueueItem, type SourceRow, type SpecialistRow } from "./gigsLogic";
import type { GigKpi } from "@/app/_lib/gigs/types";
import { Absent, GigHead, UntrustedText } from "./GigsFacts";
import { OutcomeMark } from "./GigsMarks";
import { RateLine } from "./GigsScoreRail";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The queue's other three judgements, plus the passive view of work sitting with the
// agents. Every write goes through the gigs routes and re-reads what it moved; every
// failure is shown from its code, in the reader's language.

type ViewProps = {
  item: QueueItem;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  now: Date;
  onChanged: AfterWrite;
};

function useWrite() {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await sendJson(url, method, body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
      return null;
    }
    return res.body ?? {};
  }
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
      {error}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Suspect: reasons, the untrusted text, and NO dispatch control - clear or decline only
// ---------------------------------------------------------------------------

export function SuspectView({ item, source, specialist, now, onChanged }: ViewProps) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();
  const [read, setRead] = useState(false);
  const gig = item.gig;
  const url = `/api/gigs/${encodeURIComponent(gig.id)}`;

  async function patch(action: "decline" | "clear_suspect") {
    const ok = await run(url, "PATCH", { action });
    if (ok) await onChanged(true, action === "decline" ? t("work.declinedFlash") : t("work.clearedFlash"));
  }

  return (
    <div>
      <GigHead gig={gig} crumbs={[t("views.queue"), t("queue.group.suspect"), gig.id]} source={source} specialist={specialist} now={now} />
      <div className="grid gap-6 px-5 py-5 xl:grid-cols-2">
        <div className="space-y-4">
          <h3 className={META_LABEL}>{t("suspectView.why")}</h3>
          <ul className="space-y-2">
            {gig.suspectReasons.map((r) => (
              <li key={r} className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
                <p className="font-semibold">{fmt.suspect(r)}</p>
                <p className="mt-0.5">{t(`suspectWhy.${r}` as Parameters<typeof t>[0])}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink">{t("suspectView.scanNote")}</p>
          <div className={`${PANEL_SUNKEN} px-4 py-3 text-sm`}>
            <p className="font-semibold text-ink">{t("suspectView.notDispatchable")}</p>
            <p className="mt-0.5 text-steel">{t("suspectView.noControl")}</p>
          </div>
          <ErrorLine error={error} />
          <div className="grid gap-2">
            <button type="button" disabled={busy} onClick={() => patch("decline")} className={`${BTN_PRIMARY} min-h-10 justify-start px-3 py-2 text-left text-sm`}>
              {t("suspectView.decline")}
            </button>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
              <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-4 w-4 accent-moss" />
              {t("suspectView.readIt")}
            </label>
            <button type="button" disabled={busy || !read} onClick={() => patch("clear_suspect")} className={`${BTN_SECONDARY} min-h-9 justify-start px-3 py-1.5 text-left text-sm`}>
              {t("suspectView.clear")}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <UntrustedText gig={gig} source={source} />
          <p className="break-all text-sm text-steel">{t("suspectView.urlAsText", { url: gig.url })}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record: the verdict as the external judge gave it
// ---------------------------------------------------------------------------

export function RecordView({ item, source, specialist, now, onChanged, onFlash, kpi }: ViewProps & { kpi: GigKpi | null; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const uid = useId().replace(/:/g, "");
  const { busy, error, run } = useWrite();
  const [verdict, setVerdict] = useState<GigOutcomeVerdict | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(item.gig.reward?.currency ?? "");
  const [words, setWords] = useState("");
  const [amountError, setAmountError] = useState(false);
  const gig = item.gig;
  const attempt = item.attempt;

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
    const paused = body.sourcePaused === true;
    const next = await onChanged(true, null);
    const after = next ? overallCell(next) : null;
    const parts = [t("recordView.recordedFlash", { verdict: fmt.verdict(verdict) })];
    if (before && after) parts.push(t("recordView.rateMoved", { a0: before.accepted, r0: before.resolved, a1: after.accepted, r1: after.resolved, p0: before.pending, p1: after.pending }));
    if (paused) parts.push(t("recordView.sourcePaused", { host: source?.host ?? t("facts.forwarded") }));
    onFlash(parts.join(" "));
  }

  return (
    <div>
      <GigHead
        gig={gig}
        crumbs={[t("views.queue"), t("queue.group.record"), gig.id]}
        source={source}
        specialist={specialist}
        now={now}
        extra={
          <div className="flex gap-1.5">
            <dt className="text-steel">{t("recordView.sentBy")}</dt>
            <dd className="text-ink">{fmt.dateTime(attempt?.sentAt ?? null)}</dd>
          </div>
        }
      />
      <div className="grid gap-6 px-5 py-5 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={META_LABEL}>{t("recordView.whatWentOut")}</h3>
            <span className="text-sm text-steel">
              {attempt?.review?.reviewMs != null ? t("recordView.reviewedFor", { minutes: Math.max(1, Math.round(attempt.review.reviewMs / 60000)) }) : t("recordView.reviewTimeUnknown")}
            </span>
          </div>
          <p className="text-sm text-ink">{attempt?.deliverable?.summary ?? <Absent>{t("recordView.noSummary")}</Absent>}</p>
          {attempt?.deliverable?.disclosure ? (
            <figure className="rounded-lg border-2 border-ink bg-paper px-3 py-2 dark:rounded-2xl">
              <figcaption className={META_LABEL}>{t("recordView.disclosureWent")}</figcaption>
              <blockquote className="mt-1 font-serif text-base italic text-ink">{attempt.deliverable.disclosure}</blockquote>
            </figure>
          ) : null}
          {attempt?.review?.note ? (
            <p className={`${NOTICE("info")} px-3 py-2 text-sm`}>
              <span className="font-semibold">{t("recordView.yourNote")}</span> {attempt.review.note}
            </p>
          ) : null}
          <p className="text-sm text-steel">{t("recordView.pendingNote", { waited: fmt.relative(attempt?.sentAt ?? null, now) ?? t("recordView.unknownWait") })}</p>
          {specialist ? (
            <p className="text-sm text-steel">
              {t("recordView.specialistRecord", { name: specialist.name })} <RateLine cell={kpi?.bySpecialist[specialist.id]} compact />
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <h3 className={META_LABEL}>{t("recordView.recordTitle")}</h3>
          <div role="radiogroup" aria-label={t("recordView.verdictLabel")} className="flex flex-wrap gap-2">
            {GIG_OUTCOME_VERDICTS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={verdict === v}
                onClick={() => setVerdict(v)}
                className={`focus-ring inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold dark:rounded-lg ${
                  verdict === v ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                }`}
              >
                <OutcomeMark kind={v} />
                {fmt.verdict(v)}
              </button>
            ))}
          </div>
          {verdict === "no_response" ? <p className="text-sm text-steel">{t("recordView.noResponseNote")}</p> : null}
          {verdict === "duplicate" ? <p className="text-sm text-steel">{t("recordView.duplicateNote")}</p> : null}
          {verdict === "accepted" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-ink">
                <span className="block font-semibold">{t("recordView.amount")}</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={amountError}
                  placeholder={t("recordView.amountPlaceholder")}
                  className={`${FIELD} mt-1 w-36 ${amountError ? "border-red-500" : ""}`}
                />
              </label>
              <label className="text-sm text-ink">
                <span className="block font-semibold">{t("recordView.currency")}</span>
                <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={16} className={`${FIELD} mt-1 w-24 uppercase`} />
              </label>
              <p className="basis-full text-sm text-steel">{t("recordView.ownCurrency")}</p>
              {amountError ? (
                <p role="alert" className="basis-full text-sm text-coral">
                  {t("recordView.amountInvalid")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div>
            <label htmlFor={`${uid}-words`} className="text-sm font-semibold text-ink">
              {t("recordView.wordsLabel")}
            </label>
            <p className="text-sm text-steel">{t("recordView.wordsHint")}</p>
            <textarea id={`${uid}-words`} value={words} onChange={(e) => setWords(e.target.value)} rows={3} className={`${FIELD} mt-1 w-full resize-y`} />
          </div>
          <ErrorLine error={error} />
          <button type="button" disabled={busy || !verdict} onClick={record} className={`${BTN_PRIMARY} h-10 px-4 text-sm`}>
            {t("recordView.record")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triage: a listing nobody has worked yet - dispatch it, or decline it
// ---------------------------------------------------------------------------

export function TriageView({
  item,
  source,
  specialist,
  now,
  onChanged,
  kpi,
  specialists,
  onHire,
}: ViewProps & { kpi: GigKpi | null; specialists: readonly SpecialistRow[]; onHire: (arena: GigArena) => void }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();
  const gig = item.gig;
  const q = gig.qualification;
  const inArena = specialists.filter((s) => s.spec.arena === gig.arena);
  const qualified = gig.status === "qualified";

  async function dispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (body) await onChanged(true, t("triageView.dispatchedFlash", { name: specialist?.name ?? t("desk.theAgent") }));
  }
  async function decline() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "decline" });
    if (body) await onChanged(true, t("work.declinedFlash"));
  }

  const yesNo = (v: boolean) => (v ? t("triageView.yes") : t("triageView.no"));

  return (
    <div>
      <GigHead gig={gig} crumbs={[t("views.queue"), t("queue.group.triage"), gig.id]} source={source} specialist={specialist} now={now} />
      <div className="grid gap-6 px-5 py-5 xl:grid-cols-2">
        <UntrustedText gig={gig} source={source} />
        <div className="space-y-4">
          <section>
            <h3 className={META_LABEL}>{t("triageView.qualification")}</h3>
            {q ? (
              <>
                <p className="mt-1 text-sm text-ink nums">{t("triageView.score", { score: q.score, bar: QUALIFY_BAR })}</p>
                <dl className="mt-2 divide-y divide-dotted divide-stone-200 text-sm">
                  <div className="flex justify-between gap-3 py-1">
                    <dt className="text-steel">{t("triageView.arenaFit")}</dt>
                    <dd className="text-ink">{yesNo(q.factors.arenaFit)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1">
                    <dt className="text-steel">{t("triageView.rewardKnown")}</dt>
                    <dd className="text-ink">{yesNo(q.factors.rewardKnown)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1">
                    <dt className="text-steel">{t("triageView.headroom")}</dt>
                    <dd className="text-ink nums">{q.factors.deadlineHeadroomDays === null ? <Absent>{t("facts.noDeadline")}</Absent> : t("triageView.days", { days: q.factors.deadlineHeadroomDays })}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-1">
                    <dt className="text-steel">{t("triageView.specialistAvailable")}</dt>
                    <dd className="text-ink">{yesNo(q.factors.specialistAvailable)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-1 text-sm text-steel">{t("triageView.notScored")}</p>
            )}
          </section>

          <section>
            <h3 className={META_LABEL}>{t("triageView.whoCould")}</h3>
            {inArena.length === 0 ? (
              <p className="mt-1 text-sm text-steel">{t("triageView.noneInArena", { arena: fmt.arena(gig.arena) })}</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {inArena.map((s) => (
                  <li key={s.id} className="text-sm">
                    <span className="font-semibold text-ink">{s.name}</span> <span className="text-steel">{s.spec.niche}</span>
                    {" · "}
                    <span className="text-steel">{s.hire ? fmt.hireStatus(s.hire.status) : t("specialists.noHire")}</span>
                    <div>
                      <RateLine cell={kpi?.bySpecialist[s.id]} compact />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {source?.pausedReason ? <p className={`${NOTICE("amber")} px-3 py-2 text-sm`}>{t("triageView.sourcePaused", { reason: fmt.paused(source.pausedReason) })}</p> : null}
          <ErrorLine error={error} />
          <div className="grid gap-2">
            {qualified ? (
              <button type="button" disabled={busy} onClick={dispatch} className={`${BTN_AFFIRM} min-h-10 justify-start px-3 py-2 text-left text-sm`}>
                {t("triageView.dispatch", { name: specialist?.name ?? t("triageView.itsSpecialist") })}
              </button>
            ) : (
              <div className={`${PANEL_SUNKEN} px-3 py-2 text-sm`}>
                <p className="font-semibold text-ink">{t("triageView.belowBar")}</p>
                <p className="mt-0.5 text-steel">{t("triageView.belowBarHow")}</p>
                {inArena.length === 0 ? (
                  <button type="button" onClick={() => onHire(gig.arena)} className="focus-ring mt-1 text-sm font-semibold text-coral hover:underline">
                    {t("triageView.hireFor", { arena: fmt.arena(gig.arena) })}
                  </button>
                ) : null}
              </div>
            )}
            <button type="button" disabled={busy} onClick={decline} className={`${BTN_SECONDARY} min-h-9 justify-start px-3 py-1.5 text-left text-sm`}>
              {t("triageView.decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// With the agents: a run in flight, a revision not yet dispatched, a failed run
// ---------------------------------------------------------------------------

export function AgentWorkView({ item, source, specialist, now, onChanged }: ViewProps) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();
  const gig = item.gig;
  const a = item.attempt;

  async function redispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (body) await onChanged(true, t("triageView.dispatchedFlash", { name: specialist?.name ?? t("desk.theAgent") }));
  }

  return (
    <div>
      <GigHead gig={gig} crumbs={[t("views.queue"), t(`queue.group.${item.kind}` as Parameters<typeof t>[0]), gig.id]} source={source} specialist={specialist} now={now} />
      <div className="space-y-4 px-5 py-5">
        {a?.revisionNote ? (
          <p className={`${NOTICE("info")} px-3 py-2 text-sm`}>
            <span className="font-semibold">{t("agentView.yourNote")}</span> {a.revisionNote}
          </p>
        ) : null}
        {item.kind === "running" ? (
          <div className={`${PANEL_SUNKEN} px-4 py-4 text-center`}>
            <p className="font-serif text-h3 text-ink">{t("agentView.runningTitle")}</p>
            <p className="mx-auto mt-1 max-w-xl text-sm text-steel">
              {t("agentView.runningBody", { date: fmt.dateTime(a?.createdAt ?? null), name: specialist?.name ?? t("desk.theAgent") })}
            </p>
          </div>
        ) : item.kind === "revision" ? (
          <div className={`${PANEL_SUNKEN} px-4 py-4`}>
            <p className="font-serif text-h3 text-ink">{t("agentView.revisionTitle")}</p>
            <p className="mt-1 max-w-xl text-sm text-steel">{t("agentView.revisionBody")}</p>
          </div>
        ) : (
          <div className={`${NOTICE("critical")} px-4 py-4`}>
            <p className="font-semibold">{t("agentView.failedTitle")}</p>
            <p className="mt-1 text-sm">
              {t("agentView.failedReason", { reason: a?.fallbackReason ?? t("agentView.noReason") })}{" "}
              {a?.costUsd == null ? t("desk.costUnreported") : t("desk.cost", { cost: fmt.usd(a.costUsd) })}
            </p>
          </div>
        )}
        <ErrorLine error={error} />
        {item.kind !== "running" ? (
          <button type="button" disabled={busy} onClick={redispatch} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            {item.kind === "revision" ? t("agentView.dispatchWithNote") : t("agentView.dispatchAgain")}
          </button>
        ) : null}
        <UntrustedText gig={gig} source={source} />
      </div>
    </div>
  );
}
