"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { checklistFor, deskGate, markSentGate } from "../../logic/facts";
import { checklistKeyFor } from "../../logic/keys";
import type { AfterWrite, SourceRow, SpecialistRow } from "../../logic/wire";
import { useBareKeys } from "../../data/useBareKeys";
import { DeskFacts, DeskInitials, SendBack } from "./DeskParts";
import type { DeskMemory } from "./GigsSignoff";
import { useWrite } from "./useWrite";

// ---------------------------------------------------------------------------
// The desk: a drafted or approved draft
// ---------------------------------------------------------------------------

export function Desk({
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
  const uid = useId().replace(/:/g, "");
  const items = checklistFor(gig.arena);
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
    <SendBack
      uid={uid}
      open={sendBackOpen}
      onOpenChange={setSendBackOpen}
      noteRef={noteRef}
      memory={memory}
      setMemory={setMemory}
      specialist={specialist}
      reviewNoteText={reviewNoteText}
      busy={busy}
      onSend={() => void act("revise")}
    />
  );

  return (
    <>
      <DeskInitials gig={gig} attempt={attempt} items={items} memory={memory} ticked={gate.ticked} total={gate.total} onToggle={toggle} />

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

      <DeskFacts attempt={attempt} specialist={specialist} />
    </>
  );
}
