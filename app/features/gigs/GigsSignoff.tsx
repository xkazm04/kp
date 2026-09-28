"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import { GIG_DISCLOSURE_ITEM, GIG_OUTCOME_VERDICTS, type Gig, type GigAttempt, type GigKpi, type GigOutcomeVerdict } from "@/app/_lib/gigs/types";
import { checklistFor, checklistKeyFor, deskGate, markSentGate, overallCell, queueKindOf, type SourceRow, type SpecialistRow } from "./gigsLogic";
import { OutcomeMark, RateLine } from "./GigsMarks";
import { useBareKeys } from "./useBareKeys";
import { sendJson } from "./useGigsData";
import { useGigsFormat } from "./useGigsFormat";

// The proof's sign-off (B/3's left column): what state the gig is in, and ONLY the moves
// that state allows, each through the real gigs door. For a draft it is the desk: the
// arena checklist as initials (keys 1-6), the disclosure sentence under its initial, the
// Approve gate that names its reason in its label, Send back with a note, Discard. For an
// approved draft: how to send it yourself, Open the listing, Mark sent (locked until the
// checklist is complete). A quarantined listing has no dispatch control at all - clear it
// (after saying you read it) or decline it. A sent one records the outside verdict. A
// listing nobody worked yet is dispatched or declined; work with an agent says so.
// Nothing here submits anywhere: the operator sends, kp records.

export type DeskMemory = { ticks: Record<string, boolean>; seen: string[]; note: string; startedAt: number };
export type DeskStore = Map<string, DeskMemory>;

/** What a write calls afterwards, with the sentence to say; answers the re-read KPI. */
export type AfterWrite = (flash?: string | null) => Promise<GigKpi | null>;

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
  return { busy, error, setError, run };
}

function ReviewTimer({ startedAt }: { startedAt: number }) {
  const t = useTranslations("gigs");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span className="t-meta num">{t("desk.timer", { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` })}</span>;
}

export function GigsSignoff({
  gig,
  attempt,
  source,
  specialist,
  kpi,
  now,
  findings,
  memory,
  setMemory,
  reviewNoteText,
  onChanged,
  onFlash,
  onDecline,
  onHire,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  kpi: GigKpi | null;
  now: Date;
  /** The pre-send lint's findings (the gate reads them). */
  findings: readonly DraftLintFinding[];
  memory: DeskMemory | null;
  setMemory: (update: (m: DeskMemory) => DeskMemory) => void;
  /** The reviewer's note without its header, offered as a revision note; null when none. */
  reviewNoteText: string | null;
  onChanged: AfterWrite;
  /** Say one sentence on the tab's status line, without a re-read. */
  onFlash: (message: string) => void;
  /** Decline through the proof, which lands on the next gig of the list. */
  onDecline: () => void;
  onHire: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const kind = queueKindOf(gig, attempt);
  const onDesk = attempt !== null && (attempt.status === "drafted" || attempt.status === "approved");

  const who =
    gig.status === "in_review"
      ? t("front.col.ready")
      : gig.status === "drafted"
        ? t("front.col.proof")
        : gig.status === "suspect"
          ? t("front.col.quar")
          : fmt.status(gig.status);
  const next = t(`signoff.next.${gig.status}`);

  return (
    <aside className="signoff" aria-label={t("signoff.label")}>
      <div className="so-state">
        <span className="caps dim">{t("signoff.title")}</span>
        <span className="who">{who}</span>
        <span className="t-meta">{next}</span>
      </div>
      {onDesk && memory ? (
        <Desk gig={gig} attempt={attempt} source={source} specialist={specialist} findings={findings} memory={memory} setMemory={setMemory} reviewNoteText={reviewNoteText} onChanged={onChanged} />
      ) : kind === "suspect" ? (
        <Suspect gig={gig} onChanged={onChanged} onDecline={onDecline} />
      ) : kind === "record" ? (
        <Record gig={gig} attempt={attempt} source={source} specialist={specialist} kpi={kpi} now={now} onChanged={onChanged} onFlash={onFlash} />
      ) : kind === "triage" ? (
        <Triage gig={gig} source={source} specialist={specialist} kpi={kpi} onChanged={onChanged} onDecline={onDecline} onHire={onHire} />
      ) : kind === "running" || kind === "revision" || kind === "failed" ? (
        <Agent gig={gig} attempt={attempt} specialist={specialist} kind={kind} now={now} onChanged={onChanged} />
      ) : (
        <div>
          <p className="t-meta">{t("detail.needsNobody")}</p>
        </div>
      )}
      <OffLine gig={gig} declineOffered={kind === "suspect" || kind === "triage"} onChanged={onChanged} onDecline={onDecline} />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The desk: a drafted or approved draft
// ---------------------------------------------------------------------------

function Desk({
  gig,
  attempt,
  source,
  specialist,
  findings,
  memory,
  setMemory,
  reviewNoteText,
  onChanged,
}: {
  gig: Gig;
  attempt: GigAttempt;
  source: SourceRow | null;
  specialist: SpecialistRow | null;
  findings: readonly DraftLintFinding[];
  memory: DeskMemory;
  setMemory: (update: (m: DeskMemory) => DeskMemory) => void;
  reviewNoteText: string | null;
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const uid = useId().replace(/:/g, "");
  const items = checklistFor(gig.arena);
  const dl = attempt.deliverable;
  const { busy, error, setError, run } = useWrite();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const seen = new Set(memory.seen);
  const gate = deskGate(items, memory.ticks, findings, seen);
  const sendGate = markSentGate(items, memory.ticks);
  const approved = attempt.status === "approved";

  const toggle = (key: string) => setMemory((m) => ({ ...m, ticks: { ...m.ticks, [key]: !m.ticks[key] } }));
  useBareKeys((key) => {
    const k = checklistKeyFor(key, items);
    if (!k) return false;
    toggle(k);
    return true;
  });

  // The review the attempt carries: the ticks, the operator's note - or, when they typed
  // none, the note already on the attempt (the reviewer agent's), so approving never
  // erases it - and how long the review took.
  const review = () => ({ checklist: memory.ticks, note: memory.note.trim() || attempt.review?.note || null, reviewMs: Date.now() - memory.startedAt });

  async function act(action: "approve" | "revise" | "discard" | "mark_sent") {
    setNotice(null);
    if (action === "revise" && !memory.note.trim()) {
      setError(t("desk.noteRequired"));
      setSendBackOpen(true);
      window.requestAnimationFrame(() => noteRef.current?.focus());
      return;
    }
    const body = await run(`/api/gigs/attempts/${encodeURIComponent(attempt.id)}`, "POST", { action, review: action === "revise" ? { ...review(), note: memory.note.trim() } : review() });
    if (!body) {
      // A revise whose re-dispatch failed still recorded the revision: the proof moved.
      return;
    }
    if (action === "approve") {
      setNotice(t("desk.approvedNotice"));
      await onChanged(null);
      return;
    }
    await onChanged(action === "mark_sent" ? t("desk.sentFlash") : action === "revise" ? t("desk.revisedFlash") : t("desk.discardedFlash"));
  }

  const approveLabel = (() => {
    const r = gate.reason;
    if (!r) return t("desk.approveReady");
    if (r.kind === "blockers") return t("desk.approveBlocked", { count: r.count });
    if (r.kind === "checklist") return t("desk.approveChecklist", { ticked: r.ticked, total: r.total });
    return t("desk.approveUnseen", { count: r.count });
  })();

  const sendBack = (
    <details className="sendback" open={sendBackOpen} onToggle={(e) => setSendBackOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="btn block">{t("signoff.sendBack")}</summary>
      <div className="body">
        <label htmlFor={`${uid}-note`} className="t-meta">
          {t("desk.noteLabel", { name: specialist?.name ?? t("desk.theAgent") })}
        </label>
        <textarea
          id={`${uid}-note`}
          ref={noteRef}
          className="field"
          value={memory.note}
          placeholder={t("signoff.notePlaceholder")}
          onChange={(e) => setMemory((m) => ({ ...m, note: e.target.value }))}
        />
        {reviewNoteText && !memory.note.trim() ? (
          <button type="button" className="linkbtn" onClick={() => setMemory((m) => ({ ...m, note: reviewNoteText }))}>
            {t("signoff.useReview")}
          </button>
        ) : null}
        <button type="button" className="btn primary block" disabled={busy} onClick={() => void act("revise")}>
          {t("signoff.sendBackGo")}
        </button>
      </div>
    </details>
  );

  return (
    <>
      <div className="initials" role="group" aria-label={t("desk.checklistTitle", { arena: fmt.arena(gig.arena) })}>
        <div className="so-head">
          <span className="caps dim">{t("signoff.initials")}</span>
          <span className="t-meta" aria-live="polite">
            <b>{gate.ticked}</b> / {gate.total}
          </span>
        </div>
        <div className="progress" aria-hidden>
          <i style={{ width: `${Math.round((100 * gate.ticked) / Math.max(1, gate.total))}%` }} />
        </div>
        {items.map((k, i) => (
          <label key={k} className={k === GIG_DISCLOSURE_ITEM ? "disc" : undefined}>
            <input type="checkbox" checked={memory.ticks[k] === true} onChange={() => toggle(k)} />
            <span className="box" aria-hidden>
              <svg viewBox="0 0 20 16">
                <path d="M2 8.5 L7.5 13.5 L18 2.5" />
              </svg>
            </span>
            <span className="txt">{fmt.check(k)}</span>
            <kbd aria-hidden>{i + 1}</kbd>
            {k === GIG_DISCLOSURE_ITEM ? (
              dl && dl.disclosure.trim() ? (
                <span className="said">“{dl.disclosure}”</span>
              ) : (
                <span className="said coral">{t("desk.disclosureMissing")}</span>
              )
            ) : null}
          </label>
        ))}
        <div className="so-head so-foot">
          <span />
          <ReviewTimer startedAt={memory.startedAt} />
        </div>
      </div>

      <div className="acts">
        {error ? (
          <p role="alert" className="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="note-line">
            {notice}
          </p>
        ) : null}
        {!approved ? (
          <>
            <button type="button" className="btn affirm block wrap" disabled={busy || !gate.ready} onClick={() => void act("approve")}>
              {approveLabel}
            </button>
            {gate.ready ? (
              <p className="hint">{t("desk.approveNote")}</p>
            ) : (
              <div className="hint">
                {t("desk.stillNeeded")}
                <ul>
                  {gate.blockers > 0 ? <li>{t("desk.needBlockers", { count: gate.blockers })}</li> : null}
                  {gate.total - gate.ticked > 0 ? <li>{t("desk.needChecklist", { count: gate.total - gate.ticked })}</li> : null}
                  {gate.unseenWarns > 0 ? <li>{t("desk.needSeen", { count: gate.unseenWarns })}</li> : null}
                </ul>
              </div>
            )}
            {sendBack}
            {confirmDiscard ? (
              <div className="confirm">
                <span>{t("desk.discardConfirm")}</span>
                <span className="row-form">
                  <button type="button" className="btn quiet danger" disabled={busy} onClick={() => void act("discard")}>
                    {t("desk.discardYes")}
                  </button>
                  <button type="button" className="btn quiet ghost" onClick={() => setConfirmDiscard(false)}>
                    {t("desk.discardNo")}
                  </button>
                </span>
              </div>
            ) : (
              <button type="button" className="btn ghost danger block" disabled={busy} onClick={() => setConfirmDiscard(true)}>
                {t("desk.discard")}
              </button>
            )}
          </>
        ) : (
          <>
            <p className="note-line">
              <b>{t("desk.approvedTitle")}</b> {t("desk.approvedBody", { host: source?.host ?? t("desk.theSource") })}
            </p>
            <a className="btn block" href={gig.url} target="_blank" rel="noopener noreferrer">
              {t("desk.openListing")} <ExternalLink size={14} aria-hidden />
            </a>
            <button type="button" className="btn primary block wrap" disabled={busy || !sendGate.ready} onClick={() => void act("mark_sent")}>
              {sendGate.ready ? t("desk.markSentReady") : t("desk.markSentLocked", { ticked: sendGate.ticked, total: sendGate.total })}
            </button>
            {sendBack}
          </>
        )}
      </div>

      <dl className="kv">
        {dl ? (
          <>
            <dt>{t("signoff.confidence")}</dt>
            <dd>{t("signoff.confidenceValue", { percent: fmt.percent(Math.round(dl.confidence * 100)) })}</dd>
          </>
        ) : null}
        <dt>{t("signoff.thisRun")}</dt>
        {attempt.costUsd === null ? <dd className="null">{t("signoff.costUnreported")}</dd> : <dd>{fmt.usd(attempt.costUsd)}</dd>}
        {specialist ? (
          <>
            <dt>{t("signoff.budget")}</dt>
            <dd>{fmt.usd(specialist.spec.budgetUsdPerAttempt)}</dd>
          </>
        ) : null}
      </dl>
    </>
  );
}

// ---------------------------------------------------------------------------
// A quarantined listing: clear it (after reading it) or decline it - never dispatch
// ---------------------------------------------------------------------------

function Suspect({ gig, onChanged, onDecline }: { gig: Gig; onChanged: AfterWrite; onDecline: () => void }) {
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
// Sent: record the outside verdict
// ---------------------------------------------------------------------------

function Record({
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

// ---------------------------------------------------------------------------
// Nobody worked it yet: dispatch it, or decline it
// ---------------------------------------------------------------------------

function Triage({
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

// ---------------------------------------------------------------------------
// With the agent: in flight, sent back, or failed
// ---------------------------------------------------------------------------

function Agent({
  gig,
  attempt,
  specialist,
  kind,
  now,
  onChanged,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  specialist: SpecialistRow | null;
  kind: "running" | "revision" | "failed";
  now: Date;
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();

  async function redispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (body) await onChanged(t("triageView.dispatchedFlash", { name: specialist?.name ?? t("desk.theAgent") }));
  }

  return (
    <div className="acts">
      {kind === "running" ? (
        <p className="hint">{t("signoff.running", { name: specialist?.name ?? t("desk.theAgent"), when: fmt.relative(attempt?.createdAt ?? null, now) ?? "" })}</p>
      ) : kind === "revision" ? (
        <p className="hint">
          <b>{t("agentView.revisionTitle")}.</b> {t("agentView.revisionBody")}
        </p>
      ) : (
        <p className="alert">
          <b>{t("agentView.failedTitle")}.</b> {t("agentView.failedReason", { reason: attempt?.fallbackReason ?? t("agentView.noReason") })}
        </p>
      )}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {kind !== "running" ? (
        <button type="button" className="btn block wrap" disabled={busy} onClick={() => void redispatch()}>
          {kind === "revision" ? t("agentView.dispatchWithNote") : t("agentView.dispatchAgain")}
        </button>
      ) : null}
    </div>
  );
}

/** Decline or withdraw, wherever the state machine still allows it and the panel above
 *  has not already offered it. */
function OffLine({ gig, declineOffered, onChanged, onDecline }: { gig: Gig; declineOffered: boolean; onChanged: AfterWrite; onDecline: () => void }) {
  const t = useTranslations("gigs");
  const { busy, error, run } = useWrite();
  const canDecline = !declineOffered && canTransitionGig(gig.status, "declined");
  const canWithdraw = canTransitionGig(gig.status, "withdrawn");
  if (!canDecline && !canWithdraw) return null;

  async function withdraw() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "withdraw" });
    if (body) await onChanged(t("work.withdrawnFlash"));
  }

  return (
    <div className="acts">
      <span className="caps dim">{t("detail.offLine")}</span>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <div className="row-form">
        {canDecline ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={onDecline}>
            {t("detail.decline")}
          </button>
        ) : null}
        {canWithdraw ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void withdraw()}>
            {t("detail.withdraw")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
