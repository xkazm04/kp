"use client";

// The consent cards of the round-4 tool acts, WIRED (round 6): each states what will happen
// from real data, and only its press reaches the existing door (doors.ts).
//
//   letterApprove → POST /api/outreach-letters/[id]/approve {revision}. A NAMED person approves
//                   the revision the card shows; nothing is sent. The card shows what the
//                   approval covers: recipient, subject, language and the body a release
//                   would send (the same read the letter tool makes). Done → "Review the
//                   send" arms the letterSend card: approving and sending stay two acts.
//   letterSend    → POST /api/outreach-letters/[id]/release. The one door that sends it; the
//                   result is the truthful delivery claim (sent / queued / failed).
//   interviewBook → POST /api/schedule {action:"book", entryId, dateSlot}: the week grid's door.
//   interviewLink → POST /api/schedule/invite {entryId}: mints a self-scheduling link and mails it.
//
// None has a reverse door, so none offers Undo. A refusal is answered in the reader's language
// from its CODE (useErrorMessage): OUTREACH_APPROVER_UNNAMED (403, no named approver),
// OUTREACH_APPROVAL_STALE (409, the letter changed after it was approved), SCHEDULE_SLOT_TAKEN.
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Mark, Note } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { PanelProps } from "../panels/types";
import { letterMatches, useHeldLetter, type HeldLetter, type LetterPreview } from "../tools/reads";
import type { ProposalInstance } from "../types";
import type { ResolvedAct } from "./acts";
import { ConsentFrame, isSettled, ResultLines, type Phase } from "./ConsentFrame";
import { approveLetter, bookInterview, releaseLetter, sendScheduleLink, type Delivery } from "./doors";

type Common = {
  proposal: ProposalInstance;
  epoch: number;
  onDataChanged: () => void;
  onDismiss: () => void;
  onPropose?: PanelProps["onPropose"];
  className?: string;
};

type LetterAct = Extract<ResolvedAct, { act: "letterApprove" | "letterSend" }>;
type InterviewAct = Extract<ResolvedAct, { act: "interviewBook" | "interviewLink" }>;

function languageName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    // An unknown tag: the code itself is still the truth.
    return code;
  }
}

/** What the approval covers / what the release sends: recipient, subject, language, body —
 *  compact (the body scrolls in a short box) so the card and its buttons fit one sight at
 *  1280x800 under the letter sheet. The delivery forecast lives in Details. */
function LetterFacts({ letter, preview }: { letter: HeldLetter; preview: LetterPreview | null }) {
  const t = useTranslations("one.core.consent.acts");
  const tl = useTranslations("one.core.panels.letter");
  const locale = useLocale();
  const lang = languageName(preview?.locale ?? letter.lang, locale);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-role="one-consent-letter">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        <dt className={META_LABEL}>{tl("to")}</dt>
        <dd className="min-w-0 break-words" data-role="one-consent-to">
          {preview?.recipient ?? tl("noRecipient")}
        </dd>
        <dt className={META_LABEL}>{tl("subject")}</dt>
        <dd className="min-w-0 break-words font-semibold">{preview?.subject || letter.subject || tl("noSubject")}</dd>
        <dt className={META_LABEL}>{t("language")}</dt>
        <dd className="min-w-0">{lang ?? "—"}</dd>
      </dl>
      <div className="max-h-20 overflow-y-auto rounded-md border border-stone-200 bg-white p-2 dark:rounded-lg" tabIndex={0} aria-label={tl("sends")} data-role="one-consent-body">
        <p className="whitespace-pre-wrap break-words leading-6">{preview?.body || letter.body}</p>
      </div>
    </div>
  );
}

/** Where a release would deliver it (letter-view.ts forecast), for the card's Details. */
function Forecast({ preview }: { preview: LetterPreview | null }) {
  const tl = useTranslations("one.core.panels.letter");
  if (!preview?.forecast) return null;
  return (
    <p className="flex items-start gap-1.5" data-role="one-consent-forecast">
      <Mark kind={preview.forecast === "relay" ? "ok" : preview.forecast === "local" ? "wait" : "caution"} />
      <span>{tl(`forecast.${preview.forecast}`)}</span>
    </p>
  );
}

export function LetterConsent({ act, proposal, epoch, onDataChanged, onDismiss, onPropose, className }: Common & { act: LetterAct }) {
  const t = useTranslations("one.core.consent");
  const errMsg = useErrorMessage();
  const read = useHeldLetter(act.entryId, epoch);
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const who = act.label ?? t("acts.someone");
  const approve = act.act === "letterApprove";
  const held = read.state === "ready" ? read.data : null;
  const letter = held?.letter ?? null;
  // The card agrees to what it SHOWS: a refreshing read is not yet what the door would act on.
  const current = read.state === "ready" && !read.refreshing;
  const matches = letterMatches(act, letter);
  const settled = isSettled(phase);
  const busy = phase.at === "busy";

  let body: ReactNode;
  if (settled) {
    body =
      phase.at === "failed" ? (
        <Note tone="critical">{errMsg(phase.payload, t("failed"))}</Note>
      ) : phase.at === "done" || phase.at === "undone" ? (
        <ResultLines lines={phase.lines} />
      ) : null;
  } else if (read.state === "loading") {
    body = <LoadingGap className="h-16" />;
  } else if (read.state === "error") {
    body = <Note tone="critical">{errMsg(read.payload, t("failed"))}</Note>;
  } else if (!letter || !matches) {
    body = (
      <Note tone="caution">
        {letter ? t("acts.changed", { revision: letter.revision }) : t("acts.gone", { label: who })}
      </Note>
    );
  } else {
    body = (
      <>
        <p>{approve ? t("acts.letterApprove.line", { label: who, revision: letter.revision }) : t("acts.letterSend.line", { label: who })}</p>
        <LetterFacts letter={letter} preview={held?.preview ?? null} />
      </>
    );
  }

  const canPress = !settled && current && matches;
  const footer = settled ? (
    <>
      {phase.at === "done" && approve && onPropose && letter ? (
        <Button
          label={t("acts.letterApprove.next")}
          variant="primary"
          onClick={() => onPropose("letterSend", { entryId: act.entryId, letterId: act.letterId, revision: String(letter.revision), ...(act.label ? { label: act.label } : {}) })}
          data-act="letter-send-next"
        />
      ) : null}
      {phase.at === "done" && !approve ? <p className="text-micro text-steel">{t("final")}</p> : null}
      <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
    </>
  ) : (
    <>
      <Button
        label={approve ? t("acts.letterApprove.press") : t("acts.letterSend.press")}
        variant="primary"
        disabled={!canPress}
        loading={busy}
        loadingLabel={t("working")}
        onClick={() => void run()}
        data-role="one-consent-confirm"
      />
      <Button label={t("notNow")} variant="ghost" disabled={busy} onClick={onDismiss} />
    </>
  );

  return (
    <ConsentFrame
      act={act.act}
      proposalId={proposal.id}
      phase={phase.at}
      className={className}
      title={approve ? t("acts.letterApprove.title", { label: who }) : t("acts.letterSend.title", { label: who })}
      line={body}
      footer={footer}
      tag={settled ? undefined : "final"}
      details={
        settled ? undefined : (
          <>
            <p>{approve ? t("acts.letterApprove.details") : t("acts.letterSend.details")}</p>
            <Forecast preview={held?.preview ?? null} />
          </>
        )
      }
    />
  );

  async function run() {
    if (!letter) return;
    setPhase({ at: "busy" });
    if (approve) {
      const r = await approveLetter(act.letterId, letter.revision);
      if (!r.ok) return setPhase({ at: "failed", payload: r.payload });
      setPhase({ at: "done", lines: [t("acts.letterApprove.done", { label: who, revision: r.revision })], undo: null });
    } else {
      const r = await releaseLetter(act.letterId);
      if (!r.ok) return setPhase({ at: "failed", payload: r.payload });
      setPhase({ at: "done", lines: [deliveryLine(r.delivery, "letterSend")], undo: null });
    }
    onDataChanged();
  }

  function deliveryLine(d: Delivery, k: "letterSend" | "interviewLink"): string {
    return t(`acts.${k}.${d}`, { label: who });
  }
}

export function InterviewConsent({ act, proposal, onDataChanged, onDismiss, className }: Common & { act: InterviewAct }) {
  const t = useTranslations("one.core.consent");
  const errMsg = useErrorMessage();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const who = act.label ?? t("acts.someone");
  const book = act.act === "interviewBook";
  const settled = isSettled(phase);
  const busy = phase.at === "busy";
  const when = book ? (act.when ?? act.dateSlot) : "";
  const line = book
    ? act.zone
      ? t("acts.interviewBook.lineZone", { label: who, when, zone: act.zone })
      : t("acts.interviewBook.line", { label: who, when })
    : t("acts.interviewLink.line", { label: who });

  const body =
    phase.at === "stale" ? (
      <Note tone="caution">{t("stale")}</Note>
    ) : phase.at === "failed" ? (
      <Note tone="critical">{errMsg(phase.payload, t("failed"))}</Note>
    ) : phase.at === "done" ? (
      <ResultLines lines={phase.lines} />
    ) : (
      <p>{line}</p>
    );

  return (
    <ConsentFrame
      act={act.act}
      proposalId={proposal.id}
      phase={phase.at}
      className={className}
      title={book ? t("acts.interviewBook.title", { label: who }) : t("acts.interviewLink.title", { label: who })}
      line={body}
      footer={
        settled ? (
          <>
            {phase.at === "done" ? <p className="text-micro text-steel">{t("final")}</p> : null}
            <Button label={t("notNow")} variant="ghost" onClick={onDismiss} />
          </>
        ) : (
          <>
            <Button
              label={book ? t("acts.interviewBook.press") : t("acts.interviewLink.press")}
              variant="primary"
              loading={busy}
              loadingLabel={t("working")}
              onClick={() => void run()}
              data-role="one-consent-confirm"
            />
            <Button label={t("notNow")} variant="ghost" disabled={busy} onClick={onDismiss} />
          </>
        )
      }
      tag={settled ? undefined : "final"}
      details={settled ? undefined : <p>{book ? t("acts.interviewBook.details") : t("acts.interviewLink.details")}</p>}
    />
  );

  async function run() {
    setPhase({ at: "busy" });
    if (act.act === "interviewBook") {
      const r = await bookInterview(act.entryId, act.dateSlot);
      if (!r.ok) return setPhase(r.stale ? { at: "stale" } : { at: "failed", payload: r.payload });
      setPhase({ at: "done", lines: [t("acts.interviewBook.done", { label: who, when: r.slot ?? when })], undo: null });
    } else {
      const r = await sendScheduleLink(act.entryId);
      if (!r.ok) return setPhase(r.stale ? { at: "stale" } : { at: "failed", payload: r.payload });
      setPhase({ at: "done", lines: [t(`acts.interviewLink.${r.delivery}`, { label: who })], undo: null });
    }
    onDataChanged();
  }
}
