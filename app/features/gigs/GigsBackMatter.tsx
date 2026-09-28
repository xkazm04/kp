"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigMatchReason } from "@/app/_lib/gigs/match";
import type { Gig, GigAttempt, GigKpi, GigOutcome } from "@/app/_lib/gigs/types";
import type { ReviewNote } from "./deskLogic";
import { evidenceState, QUALIFY_BAR, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { GigBriefPanel } from "./GigsBrief";
import { UntrustedText } from "./GigsFacts";
import { OutcomeMark } from "./GigsMarks";
import type { AfterWrite } from "./GigsSignoff";
import { routingView } from "./routingView";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The proof's back matter (B/3): the machinery behind the draft, one step away and never
// lost, each fold lettered and carrying its one-word count so the operator knows what is
// inside before opening it.
//   A Evidence            what the agent ran: passed, failed, NOT VERIFIED (never two states)
//   B Pre-send review     the reviewer's note, set out: must-dos, defects, the checks it ran
//   C Earlier proofs      every attempt, its cost, the notes that sent it back, the verdicts
//   D Research brief      the brief (GigsBrief.tsx), with Research / Research again
//   E The listing         a stranger's text, framed as untrusted, invisible characters shown
//   F Routing & folder    who it goes to and why, every candidate, the folder, the score

type Fold = "evidence" | "review" | "history" | "brief" | "listing" | "routing";

export function GigsBackMatter({
  gig,
  attempt,
  source,
  specialists,
  kpi,
  note,
  open,
  onOpen,
  onChanged,
  onOpenLane,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  note: ReviewNote | null;
  /** Folds the proof opened on purpose (a jump from the slip). */
  open: ReadonlySet<Fold>;
  onOpen: (fold: Fold, value: boolean) => void;
  onChanged: AfterWrite;
  onOpenLane: () => void;
}) {
  const t = useTranslations("gigs");
  const dl = attempt?.deliverable ?? null;
  const failed = dl ? dl.evidence.filter((e) => e.passed === false).length : 0;
  const brief = gig.brief;

  const folds: { id: Fold; title: string; n: ReactNode; body: ReactNode; show: boolean }[] = [
    {
      id: "evidence",
      title: t("back.evidence"),
      n: dl ? (dl.evidence.length ? `${dl.evidence.length}${failed ? ` · ${t("back.failedN", { count: failed })}` : ""}` : t("back.noneRecorded")) : "",
      body: dl ? <Evidence evidence={dl.evidence} /> : null,
      show: dl !== null,
    },
    {
      id: "review",
      title: t("back.review"),
      n: note ? (note.header ? (note.byAgent ? (note.cycle ? t("back.byAgentCycle", { cycle: note.cycle }) : t("back.byAgent")) : t("back.byReviewer")) : t("back.yourNote")) : t("back.noneOnFile"),
      body: <Review note={note} />,
      show: attempt !== null,
    },
    { id: "history", title: t("back.history"), n: "", body: <History gig={gig} specialists={specialists} />, show: true },
    {
      id: "brief",
      title: t("back.brief"),
      n: brief ? [brief.difficulty === "unrated" ? t("brief.level.unrated") : t(`brief.level.${brief.difficulty}`), brief.effort ? t("brief.effortRange", { min: brief.effort.minHours, max: brief.effort.maxHours }) : null].filter(Boolean).join(" · ") : t("back.notResearched"),
      body: <GigBriefPanel gig={gig} onChanged={onChanged} />,
      show: true,
    },
    {
      id: "listing",
      title: t("back.listing"),
      n: gig.suspectReasons.length ? <span className="coral">{t("back.flags", { count: gig.suspectReasons.length })}</span> : (gig.org ?? t("back.untrusted")),
      body: <Listing gig={gig} source={source} />,
      show: true,
    },
    {
      id: "routing",
      title: t("back.routing"),
      n: gig.qualification ? t("back.fit", { score: gig.qualification.score }) : t("back.notScored"),
      body: <Routing gig={gig} source={source} specialists={specialists} kpi={kpi} onChanged={onChanged} onOpenLane={onOpenLane} />,
      show: true,
    },
  ];

  let letter = 0;
  return (
    <section className="backmatter" aria-label={t("back.label")}>
      <div className="caps dim">{t("back.title")}</div>
      {folds
        .filter((f) => f.show)
        .map((f) => {
          const ap = String.fromCharCode(65 + letter++);
          return (
            <details key={f.id} id={`gd-fold-${f.id}`} className="bm" open={open.has(f.id) || undefined} onToggle={(e) => onOpen(f.id, (e.currentTarget as HTMLDetailsElement).open)}>
              <summary>
                <span className="ap" aria-hidden>
                  {ap}
                </span>
                <span className="ti">{f.title}</span>
                <span className="n">{f.n}</span>
              </summary>
              <div className="body">{f.body}</div>
            </details>
          );
        })}
    </section>
  );
}

export type { Fold as BackFold };

function Evidence({ evidence }: { evidence: NonNullable<GigAttempt["deliverable"]>["evidence"] }) {
  const t = useTranslations("gigs");
  if (evidence.length === 0) return <p className="dim">{t("desk.noEvidence")}</p>;
  return (
    <div>
      {evidence.map((e, i) => {
        const st = evidenceState(e.passed);
        return (
          <div key={i} id={`gd-ev-${i}`} className="ev">
            <span className={st === "passed" ? "ok" : st === "failed" ? "no" : "unv"} aria-label={t(`evidenceState.${st}`)} role="img">
              {st === "passed" ? "✓" : st === "failed" ? "✗" : "?"}
            </span>
            <div>
              <div className="t-meta">
                {t("desk.evidenceHead", { n: i + 1, kind: t.has(`evidenceKind.${e.kind}`) ? t(`evidenceKind.${e.kind}`) : e.kind })} · {t(`evidenceState.${st}`)}
              </div>
              {e.command ? <div className="cmd">$ {e.command}</div> : <div className="absent">{t("desk.noCommand")}</div>}
              <div className="res">{e.result}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Review({ note }: { note: ReviewNote | null }) {
  const t = useTranslations("gigs");
  if (!note) return <p className="dim">{t("back.noReview")}</p>;
  return (
    <>
      <div className="kicker">
        {note.verdict === "blocker" ? (
          <b className="coral">{t("slip.reviewBlockers", { count: note.blockers })}</b>
        ) : note.verdict === "warnings" ? (
          <b>{t("back.warningsYouDecide")}</b>
        ) : (
          <b>{t("back.noteWord")}</b>
        )}
        <span className="t-meta">{t("back.noteLength", { count: note.length })}</span>
      </div>
      {note.lead ? <p className="md">{note.lead}</p> : null}
      {note.items.length ? (
        <div className="review-must">
          <h3 className="t-h3">{t("back.mustDo", { count: note.items.length })}</h3>
          <ol>
            {note.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {note.defects.length ? (
        <div className="review-must">
          <h3 className="t-h3">{t("back.defects", { count: note.defects.length })}</h3>
          <ol>
            {note.defects.map((d, i) => (
              <li key={i} className={d.blocker ? "blocker" : undefined}>
                {d.blocker ? <b className="coral">{t("slip.blockerWord")} </b> : null}
                {d.text}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {note.checks.length ? (
        <details>
          <summary className="linkbtn">{t("back.checks", { count: note.checks.length })}</summary>
          <ol className="t-meta checks">
            {note.checks.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

type GigRecord = { gig: Gig; attempts: GigAttempt[]; outcomes: GigOutcome[] };

/** Every attempt and every verdict, read fresh from GET /api/gigs/[id] (the list carries
 *  only the latest attempt). Re-read when the gig moves. */
function History({ gig, specialists }: { gig: Gig; specialists: readonly SpecialistRow[] }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const [record, setRecord] = useState<GigRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/gigs/${encodeURIComponent(gig.id)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (GigRecord & ApiErrorPayload) | null;
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

  if (error)
    return (
      <p role="alert" className="alert">
        {error}
      </p>
    );
  if (!record) return <p className="t-meta">{t("detail.loadingRecord")}</p>;
  const nameOf = (id: string) => specialists.find((s) => s.id === id)?.name ?? t("desk.theAgent");
  const byAttempt = new Map<string, GigOutcome[]>();
  for (const o of record.outcomes) byAttempt.set(o.attemptId ?? "", [...(byAttempt.get(o.attemptId ?? "") ?? []), o]);
  const A = record.attempts;
  if (A.length === 0)
    return (
      <p className="dim">
        {t("detail.neverAttempted")}. {t("detail.neverAttemptedBody")}
      </p>
    );
  return (
    <ol className="hist">
      {A.map((a, i) => {
        const opener = a.revisionNote;
        const outcomes = byAttempt.get(a.id) ?? [];
        const tone = a.status === "failed" ? "coral" : a.status === "approved" || a.status === "sent" ? "moss" : undefined;
        return (
          <li key={a.id} className={i === A.length - 1 ? "cur" : undefined}>
            <span className="n">{i + 1}</span>
            <div>
              <div className="line">
                <b className={tone}>{fmt.attemptStatus(a.status)}</b>
                <span className="dim">{fmt.dateTime(a.createdAt)}</span>
                <span className="dim">{nameOf(a.specialistId)}</span>
                <span>{a.costUsd === null ? <span className="absent">{t("signoff.costUnreported")}</span> : fmt.usd(a.costUsd)}</span>
                {a.sentAt ? <span>{t("detail.sentAt", { date: fmt.dateTime(a.sentAt) })}</span> : null}
              </div>
              {a.fallbackReason ? <div className="coral">{t("agentView.failedReason", { reason: a.fallbackReason })}</div> : null}
              {opener ? (
                <details>
                  <summary className="linkbtn">{t("back.openedBy")}</summary>
                  <p className="said">{opener}</p>
                </details>
              ) : null}
              {a.status === "sent" && outcomes.length === 0 ? (
                <div className="verdict-line">
                  <OutcomeMark kind="pending" /> {t("mark.pending")}
                </div>
              ) : null}
              {outcomes.map((o) => (
                <div key={o.id} className="verdict-line">
                  <OutcomeMark kind={o.verdict} /> <b>{fmt.verdict(o.verdict)}</b>
                  <span className="dim">{t("detail.recorded", { date: fmt.dateTime(o.recordedAt), source: t(`outcomeSource.${o.source.replace(":", "_")}` as never) })}</span>
                  {o.amount !== null ? <b>{fmt.money(o.amount, o.currency)}</b> : o.verdict === "accepted" ? <span className="absent">{t("detail.amountUnknown")}</span> : null}
                  {o.feedbackText ? <p className="said">{o.feedbackText}</p> : <span className="dim">{t("detail.noWords")}</span>}
                </div>
              ))}
            </div>
          </li>
        );
      })}
      {(byAttempt.get("") ?? []).map((o) => (
        <li key={o.id}>
          <span className="n">·</span>
          <div className="verdict-line">
            <OutcomeMark kind={o.verdict} /> <b>{fmt.verdict(o.verdict)}</b>
            <span className="dim">{fmt.dateTime(o.recordedAt)}</span>
            {o.feedbackText ? <p className="said">{o.feedbackText}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Listing({ gig, source }: { gig: Gig; source: SourceRow | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const suspect = gig.status === "suspect" || gig.suspectReasons.length > 0;
  return (
    <>
      {gig.suspectReasons.length ? (
        <div className="review-must">
          <h3 className="t-h3 coral">{t("suspectView.why")}</h3>
          <ol>
            {gig.suspectReasons.map((r) => (
              <li key={r}>
                <b>{fmt.suspect(r)}.</b> {t(`suspectWhy.${r}` as never)}
              </li>
            ))}
          </ol>
          <p className="t-meta">{t("suspectView.scanNote")}</p>
        </div>
      ) : null}
      <UntrustedText gig={gig} source={source} />
      {suspect ? (
        <p className="t-meta anywhere">
          {t("suspectView.urlAsText", { url: gig.url })}
        </p>
      ) : (
        <a className="linkbtn" href={gig.url} target="_blank" rel="noopener noreferrer">
          {t("back.original")}
        </a>
      )}
      {gig.tags.length ? (
        <div className="cats">
          {gig.tags.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

type Translate = ReturnType<typeof useTranslations<"gigs">>;
function reasonText(t: Translate, r: GigMatchReason): string {
  return t(`routing.reason.${r.code}`, { evidence: r.evidence ?? "" });
}

/** Who the gig goes to and why (the matcher's ranking - app/_lib/gigs/match.ts, the same
 *  function the qualifier runs), Route here / Auto-match, a hire when nothing fits; the
 *  folder the run works in and its Personas project; the scan's qualification factors. */
function Routing({
  gig,
  source,
  specialists,
  kpi,
  onChanged,
  onOpenLane,
}: {
  gig: Gig;
  source: SourceRow | null;
  specialists: readonly SpecialistRow[];
  kpi: GigKpi | null;
  onChanged: AfterWrite;
  onOpenLane: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const resolveError = useErrorMessage();
  const view = useMemo(() => routingView(gig, specialists, kpi), [gig, specialists, kpi]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [niche, setNiche] = useState(view.suggestedNiche ?? "");
  const [ws, setWs] = useState<{ workdir: string | null; linked: boolean | null; reason: string | null } | null>(null);
  const q = gig.qualification;
  const workdir = gig.workdir ?? ws?.workdir ?? null;
  const linked = gig.personasProjectId !== null || ws?.linked === true;

  async function write(url: string, method: "POST" | "PATCH", body: unknown, flash: string | null, fallback: string) {
    if (busy) return null;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await sendJson(url, method, body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, fallback));
      return null;
    }
    if (flash) setDone(flash);
    await onChanged(null);
    return res.body;
  }

  async function prepare() {
    const body = await write(`/api/gigs/${encodeURIComponent(gig.id)}/workspace`, "POST", {}, null, t("workspace.failed"));
    if (!body) return;
    const next = body.gig as Gig | undefined;
    const p = body.personas as { linked?: unknown; reason?: unknown } | undefined;
    setWs({ workdir: next?.workdir ?? null, linked: p?.linked === true, reason: typeof p?.reason === "string" ? p.reason : null });
  }

  const reasonKey = ws?.reason ? `workspace.reason.${ws.reason}` : null;
  const linkReason = reasonKey && t.has(reasonKey as never) ? t(reasonKey as never) : (ws?.reason ?? "").replace(/_/g, " ");

  return (
    <>
      <div className="facts-grid">
        <div>
          <span className="caps dim">{t("routing.goesTo")}</span>
          {view.current ? <b>{view.current.spec.niche}</b> : <b className="null">{t("routing.noneMatched")}</b>}
          {view.current ? <span className="t-meta">{view.routed ? t("routing.routedByYou") : t("routing.autoMatched")}</span> : null}
        </div>
        <div>
          <span className="caps dim">{t("back.fitScore")}</span>
          {q ? <b>{q.score}</b> : <b className="null">{t("back.notScored")}</b>}
          <span className="t-meta">{t("back.bar", { bar: QUALIFY_BAR })}</span>
        </div>
        <div>
          <span className="caps dim">{t("back.wire")}</span>
          <b className="t-h3">{source ? source.host : t("facts.forwarded")}</b>
          {source?.pausedReason ? <span className="t-meta coral">{fmt.paused(source.pausedReason)}</span> : null}
        </div>
        <div>
          <span className="caps dim">{t("workspace.folder")}</span>
          {workdir ? <code>{workdir}</code> : <b className="null">{t("workspace.notPrepared")}</b>}
          <span className="t-meta">
            {t("workspace.project")}: {linked ? t("workspace.linked") : ws?.reason ? t("workspace.notLinkedReason", { reason: linkReason }) : t("workspace.notLinked")}
          </span>
        </div>
      </div>

      <div className="row-form wrap">
        <button type="button" className="btn quiet" disabled={busy} onClick={() => void prepare()}>
          {t("workspace.prepare")}
        </button>
        {view.routed && !view.lock ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void write(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "unroute" }, t("routing.unroutedFlash"), t("routing.failed"))}>
            {t("routing.autoMatch")}
          </button>
        ) : null}
        <button type="button" className="btn quiet ghost" onClick={onOpenLane}>
          {t("back.inLanes")}
        </button>
      </div>
      {view.lock ? <p className="note-line">{t(`routing.locked.${view.lock}`)}</p> : null}

      {q ? (
        <dl className="kv narrow-kv">
          <dt>{t("triageView.arenaFit")}</dt>
          <dd>{q.factors.arenaFit ? t("triageView.yes") : t("triageView.no")}</dd>
          <dt>{t("triageView.rewardKnown")}</dt>
          <dd>{q.factors.rewardKnown ? t("triageView.yes") : t("triageView.no")}</dd>
          <dt>{t("triageView.headroom")}</dt>
          {q.factors.deadlineHeadroomDays === null ? <dd className="null">{t("facts.noDeadline")}</dd> : <dd>{t("triageView.days", { days: q.factors.deadlineHeadroomDays })}</dd>}
          <dt>{t("triageView.specialistAvailable")}</dt>
          <dd>{q.factors.specialistAvailable ? t("triageView.yes") : t("triageView.no")}</dd>
        </dl>
      ) : null}

      {view.ranked.length ? (
        <details>
          <summary className="linkbtn">{t("routing.candidates", { count: view.ranked.length, arena: fmt.arena(gig.arena) })}</summary>
          <ol className="candidates">
            {view.ranked.map((c) => {
              const isCurrent = c.specialistId === view.current?.id;
              return (
                <li key={c.specialistId}>
                  <div>
                    <span className="nm">{c.specialist.name}</span>
                    {isCurrent ? <span className="t-meta"> · {t("routing.current")}</span> : null}
                    <ul>
                      {c.reasons
                        .filter((r) => r.code !== "hire_not_ready" && r.code !== "no_hire")
                        .map((r, i) => (
                          <li key={`${r.code}-${i}`}>{reasonText(t, r)}</li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <span className="num">{t("routing.fit", { score: c.score })}</span>
                    <div className="fitbar" role="img" aria-label={t("routing.fitLabel", { name: c.specialist.name, score: c.score })}>
                      <i className={c.score >= 70 ? "hi" : c.score < 40 ? "lo" : undefined} style={{ width: `${Math.max(2, Math.min(100, c.score))}%` }} />
                    </div>
                    <span className="t-meta">{c.ready ? t("routing.ready") : t("routing.notReady", { status: c.specialist.hire?.status ? fmt.hireStatus(c.specialist.hire.status) : t("routing.reason.no_hire") })}</span>
                  </div>
                  <div>
                    {c.ready && !isCurrent && !view.lock ? (
                      <button
                        type="button"
                        className="btn quiet"
                        disabled={busy}
                        onClick={() => void write(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "route", specialistId: c.specialistId }, t("routing.routedFlash", { name: c.specialist.name }), t("routing.failed"))}
                      >
                        {t("routing.routeHere")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      ) : (
        <p className="t-meta">{t("routing.noCandidates", { arena: fmt.arena(gig.arena) })}</p>
      )}

      {view.noFit && !view.lock ? (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!niche.trim()) {
              setError(t("routing.nicheRequired"));
              return;
            }
            void write("/api/gigs/specialists", "POST", { arena: gig.arena, niche: niche.trim() }, t("routing.hired"), t("routing.hireFailed"));
          }}
        >
          <p className="t-meta">
            <b>{t("routing.noFitTitle")}</b> {t("routing.noFitBody")}
          </p>
          <label>
            <span>{t("routing.nicheLabel")}</span>
            <input className="field" value={niche} maxLength={80} onChange={(e) => setNiche(e.target.value)} />
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            {t("routing.hire")}
          </button>
        </form>
      ) : null}

      {busy ? (
        <p role="status" className="t-meta">
          {t("routing.working")}
        </p>
      ) : null}
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
    </>
  );
}
