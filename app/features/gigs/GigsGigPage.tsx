"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL, NOTICE, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigArena, GigAttempt, GigKpi, GigOutcome } from "@/app/_lib/gigs/types";
import { queueKindOf, type AfterWrite, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { GigBriefPanel } from "./GigsBrief";
import { Absent, GigHead, UntrustedText } from "./GigsFacts";
import { OutcomeMark } from "./GigsMarks";
import { AgentPanel, OffLineMoves, QualificationFacts, RecordPanel, SuspectPanel, TriagePanel } from "./GigsWorkViews";
import { useGigsFormat } from "./useGigsFormat";

// A gig's full page, for every status the review desk does not own: the research brief
// (GigsBrief.tsx), the listing as untrusted text, the journey so far (every attempt with its cost and notes, every
// verdict appended to it with the judge's own words), the qualification factors, and
// the moves the status still allows - clear or decline a suspect, dispatch or decline a
// new one, record the outside verdict, re-dispatch a failed run, withdraw.

type GigRecordAnswer = { gig: Gig; attempts: GigAttempt[]; outcomes: GigOutcome[] };

export function GigsGigPage({
  gig,
  latest,
  source,
  specialist,
  specialists,
  kpi,
  now,
  onChanged,
  onRated,
  onHire,
}: {
  gig: Gig;
  latest: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  now: Date;
  onChanged: AfterWrite;
  onRated: (message: string) => void;
  onHire: (arena: GigArena) => void;
}) {
  const t = useTranslations("gigs");
  const kind = queueKindOf(gig, latest);
  const panelProps = { gig, attempt: latest, source, specialist, now, onChanged };

  const panel =
    kind === "suspect" ? (
      <SuspectPanel {...panelProps} />
    ) : kind === "record" ? (
      <RecordPanel {...panelProps} kpi={kpi} onRated={onRated} />
    ) : kind === "triage" ? (
      <TriagePanel {...panelProps} kpi={kpi} specialists={specialists} onHire={onHire} />
    ) : kind === "running" || kind === "revision" || kind === "failed" ? (
      <AgentPanel {...panelProps} kind={kind} />
    ) : (
      <div className={`${PANEL_SUNKEN} px-4 py-3 text-sm`}>
        <p className="font-semibold text-ink">{gig.status === "accepted" || gig.status === "rejected" ? t("detail.restingJudged") : t("detail.restingLeft")}</p>
        <p className="mt-0.5 text-steel">{t("detail.needsNobody")}</p>
      </div>
    );

  return (
    <div>
      <GigHead gig={gig} source={source} specialist={specialist} now={now} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8 px-5 py-5 lg:border-r lg:border-stone-200">
          <GigBriefPanel gig={gig} onChanged={onChanged} />
          <section className="space-y-2">
            <h3 className={META_LABEL}>{t("detail.listing")}</h3>
            <UntrustedText gig={gig} source={source} />
          </section>
          <Journey gig={gig} specialists={specialists} now={now} />
        </div>
        <aside className="space-y-6 border-t border-stone-200 px-5 py-5 lg:border-t-0" aria-label={t("detail.nextMove")}>
          <div className="space-y-3">
            <h3 className={META_LABEL}>{t("detail.nextMove")}</h3>
            {panel}
          </div>
          <QualificationFacts gig={gig} />
          <OffLineMoves gig={gig} onChanged={onChanged} declineOffered={kind === "suspect" || kind === "triage"} />
        </aside>
      </div>
    </div>
  );
}

/** The journey so far, read fresh from GET /api/gigs/[id]: every attempt (not only the
 *  latest the list carries) and every verdict appended to it. Re-read when the gig moves. */
function Journey({ gig, specialists, now }: { gig: Gig; specialists: readonly SpecialistRow[]; now: Date }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [record, setRecord] = useState<GigRecordAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/gigs/${encodeURIComponent(gig.id)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (GigRecordAnswer & ApiErrorPayload) | null;
        if (!alive) return;
        if (!r.ok || !body) setError(resolveError(body, t("detail.recordFailed")));
        else {
          setError(null);
          setRecord(body);
        }
      })
      .catch(() => {
        // Unreachable server: the generic sentence is all there is to say.
        if (alive) setError(t("detail.recordFailed"));
      });
    return () => {
      alive = false;
    };
  }, [gig.id, gig.updatedAt, resolveError, t]);

  const nameOf = (id: string) => specialists.find((s) => s.id === id)?.name ?? t("desk.theAgent");
  const outcomesByAttempt = new Map<string, GigOutcome[]>();
  for (const o of record?.outcomes ?? []) {
    const k = o.attemptId ?? "";
    outcomesByAttempt.set(k, [...(outcomesByAttempt.get(k) ?? []), o]);
  }
  // A verdict recorded without an attempt id belongs to the gig as a whole: shown last.
  const loose = outcomesByAttempt.get("") ?? [];
  const attempts = record?.attempts ?? [];

  return (
    <section className="space-y-3">
      <h3 className={META_LABEL}>{t("detail.journey")}</h3>
      {error ? (
        <p role="alert" className={`${NOTICE("critical")} px-3 py-2 text-sm`}>
          {error}
        </p>
      ) : null}
      {!record && !error ? <p className="text-sm text-steel">{t("detail.loadingRecord")}</p> : null}
      {record ? (
        <ol className="ml-2 border-l-2 border-stone-200 pl-5">
          <Stop now={false}>
            <p className="text-sm text-ink">
              <span className="font-semibold">{t("detail.listed")}</span>{" "}
              <span className="text-steel">{gig.postedAt ? fmt.date(gig.postedAt) : <Absent>{t("detail.postedUnknown")}</Absent>}</span>
            </p>
          </Stop>
          {attempts.length === 0 ? (
            <Stop now>
              <p className="text-sm font-semibold text-ink">{t("detail.neverAttempted")}</p>
              <p className="text-sm text-steel">{t("detail.neverAttemptedBody")}</p>
            </Stop>
          ) : null}
          {attempts.map((a, i) => {
            const outcomes = outcomesByAttempt.get(a.id) ?? [];
            return (
              <Stop key={a.id} now={i === attempts.length - 1 && loose.length === 0}>
                <p className="text-sm text-ink">
                  <span className="font-semibold">{t("detail.attemptN", { n: i + 1, name: nameOf(a.specialistId) })}</span>
                  {" · "}
                  {fmt.attemptStatus(a.status)}
                </p>
                <p className="text-sm text-steel nums">
                  {fmt.dateTime(a.createdAt)} · {a.costUsd === null ? t("desk.costUnreported") : t("desk.cost", { cost: fmt.usd(a.costUsd) })}
                  {a.sentAt ? ` · ${t("detail.sentAt", { date: fmt.dateTime(a.sentAt) })}` : null}
                </p>
                {a.fallbackReason ? <p className="mt-1 text-sm text-coral">{t("agentView.failedReason", { reason: a.fallbackReason })}</p> : null}
                {a.revisionNote ? (
                  <p className={`${NOTICE("info")} mt-1.5 px-3 py-1.5 text-sm`}>
                    <span className="font-semibold">{t("agentView.yourNote")}</span> {a.revisionNote}
                  </p>
                ) : null}
                {a.review?.note ? (
                  <p className="mt-1 text-sm text-steel">
                    <span className="font-semibold">{t("recordView.yourNote")}</span> {a.review.note}
                  </p>
                ) : null}
                {a.status === "sent" && outcomes.length === 0 ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-steel">
                    <OutcomeMark kind="pending" /> {t("mark.pending")}
                    {a.sentAt ? <span>· {fmt.relative(a.sentAt, now)}</span> : null}
                  </p>
                ) : null}
                {outcomes.map((o) => (
                  <Verdict key={o.id} outcome={o} />
                ))}
              </Stop>
            );
          })}
          {loose.length > 0 ? (
            <Stop now>
              {loose.map((o) => (
                <Verdict key={o.id} outcome={o} />
              ))}
            </Stop>
          ) : null}
        </ol>
      ) : null}
    </section>
  );
}

/** One stop on the journey: a ring on the rule, filled for where the gig is now. */
function Stop({ now, children }: { now: boolean; children: ReactNode }) {
  return (
    <li className="relative pb-4 last:pb-0">
      <span
        aria-hidden
        className={`absolute -left-7 top-1 h-3.5 w-3.5 rounded-full border-2 ${now ? "border-coral bg-coral" : "border-stone-300 bg-white"}`}
      />
      {children}
    </li>
  );
}

function Verdict({ outcome: o }: { outcome: GigOutcome }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
    <div className="mt-1.5 border-t border-dotted border-stone-200 pt-1.5">
      <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-ink">
        <OutcomeMark kind={o.verdict} /> <span className="font-semibold">{fmt.verdict(o.verdict)}</span>
        <span className="text-steel">{t("detail.recorded", { date: fmt.dateTime(o.recordedAt), source: t(`outcomeSource.${o.source.replace(":", "_")}` as Parameters<typeof t>[0]) })}</span>
        {o.amount !== null ? <span className="font-semibold nums">{fmt.money(o.amount, o.currency)}</span> : o.verdict === "accepted" ? <Absent>{t("detail.amountUnknown")}</Absent> : null}
      </p>
      {o.feedbackText ? <blockquote className="mt-1 border-l-2 border-stone-300 pl-2 text-sm text-ink">{o.feedbackText}</blockquote> : <p className="mt-1 text-sm text-steel">{t("detail.noWords")}</p>}
    </div>
  );
}
