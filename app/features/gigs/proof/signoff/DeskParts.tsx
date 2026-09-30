"use client";

import { useEffect, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { GIG_DISCLOSURE_ITEM, type Gig, type GigAttempt } from "@/app/_lib/gigs/types";
import { isKpDraft } from "../../logic/proposal";
import type { SpecialistRow } from "../../logic/wire";
import { useGigsFormat } from "../../data/useGigsFormat";
import type { DeskMemory } from "./GigsSignoff";

// The desk's parts (Desk.tsx holds the state and the moves): the checklist as initials
// with the review timer, the send-back fold, and the run's facts.

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

/** The arena checklist as initials (keys 1-6), the disclosure sentence under its initial. */
export function DeskInitials({
  gig,
  attempt,
  items,
  memory,
  ticked,
  total,
  onToggle,
}: {
  gig: Gig;
  attempt: GigAttempt;
  items: readonly string[];
  memory: DeskMemory;
  ticked: number;
  total: number;
  onToggle: (key: string) => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const dl = attempt.deliverable;
  return (
    <div className="initials" role="group" aria-label={t("desk.checklistTitle", { arena: fmt.arena(gig.arena) })}>
      <div className="so-head">
        <span className="caps dim">{t("signoff.initials")}</span>
        <span className="t-meta" aria-live="polite">
          <b>{ticked}</b> / {total}
        </span>
      </div>
      <div className="progress" aria-hidden>
        <i style={{ width: `${Math.round((100 * ticked) / Math.max(1, total))}%` }} />
      </div>
      {items.map((k, i) => (
        <label key={k} className={k === GIG_DISCLOSURE_ITEM ? "disc" : undefined}>
          <input type="checkbox" checked={memory.ticks[k] === true} onChange={() => onToggle(k)} />
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
  );
}

/** Send back with a note: the operator's words, or the reviewer's note offered in one click. */
export function SendBack({
  uid,
  open,
  onOpenChange,
  noteRef,
  memory,
  setMemory,
  specialist,
  reviewNoteText,
  busy,
  onSend,
}: {
  uid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  memory: DeskMemory;
  setMemory: (update: (m: DeskMemory) => DeskMemory) => void;
  specialist: SpecialistRow | null;
  reviewNoteText: string | null;
  busy: boolean;
  onSend: () => void;
}) {
  const t = useTranslations("gigs");
  return (
    <details className="sendback" open={open} onToggle={(e) => onOpenChange((e.currentTarget as HTMLDetailsElement).open)}>
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
        <button type="button" className="btn primary block" disabled={busy} onClick={onSend}>
          {t("signoff.sendBackGo")}
        </button>
      </div>
    </details>
  );
}

/** The run's facts: the agent's own confidence, this run's cost, the budget per attempt. kp's
 *  own bid carries a fixed confidence (no agent judged it), so none is shown for it. */
export function DeskFacts({ attempt, specialist }: { attempt: GigAttempt; specialist: SpecialistRow | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const dl = attempt.deliverable;
  return (
    <dl className="kv">
      {dl && !isKpDraft(attempt) ? (
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
  );
}
