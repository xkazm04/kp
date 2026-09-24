"use client";

// The feedback-letter EDITOR (spark interview-feedback-letter, WP-beta). The recruiter
// reads the draft — and whether a model or the keyless template wrote it — edits it
// freely, and then either approves it (their edited text becomes the human-owned final
// text and is sent), asks for a fresh draft, or declines with a confirm step. Every door
// answers a CODE, resolved here in the reader's language; every outcome is said as it
// happened (delivery-honest: "sent" only when the relay accepted it).
//
// A redraft never locks the editor: approving or declining while it runs is safe, because
// a late draft loses to a decision at the store's compare-and-swap.
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextArea } from "@/app/_components/TextArea";
import { BTN_AFFIRM, BTN_GHOST, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { TaskFlightNote } from "@/app/features/shell/tasks/TaskFlightNote";
import { isLocale } from "@/i18n/locales";
import type { FeedbackLetterQueueItem } from "@/app/_lib/interview-letter-review";
import {
  deliveryNotice,
  failureStalesQueue,
  foldLetterDoor,
  letterLength,
  redraftPhase,
  type DeliveryNoticeKey,
  type DeliveryOutcome,
  type LetterDoorFailure,
  type LetterDoorResult,
  type ReadabilityNoticeKey,
} from "./feedbackLetterEditorLogic";

type Action = "approve" | "decline" | "redraft";
type Done = { kind: "approved"; delivery: DeliveryOutcome | null } | { kind: "declined"; closeOnly: boolean };

export function DecisionsFeedbackLetterEditor({
  item,
  onClose,
  onChanged,
}: {
  item: FeedbackLetterQueueItem;
  onClose: () => void;
  /** Read the queue again (a decision landed, or a redraft is ready). */
  onChanged: () => void;
}) {
  const t = useTranslations("decisions.feedbackLetters");
  const tLanguage = useTranslations("language");
  const { date } = useDateFormat();
  const errMsg = useErrorMessage();
  const relayConfigured = useDeliveryCapability();
  const countId = useId();

  const [text, setText] = useState(item.draft?.text ?? "");
  const [edited, setEdited] = useState(false);
  const [seenDraftAt, setSeenDraftAt] = useState(item.draft?.createdAt ?? null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [failure, setFailure] = useState<LetterDoorFailure | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [redraftTaskId, setRedraftTaskId] = useState<string | null>(null);
  const [redraftApplied, setRedraftApplied] = useState(false);
  const watch = useTaskResult(redraftTaskId);
  const redraft = redraftPhase(redraftTaskId, watch);

  // A newer draft reached the row. Adjusted during render — React's shape for state that
  // follows a changed prop. It replaces the text only when that is what the recruiter was
  // told would happen: they asked for a redraft, or they have not touched the text yet
  // (the first draft landing while the editor is open). Otherwise their edits stand.
  const draftAt = item.draft?.createdAt ?? null;
  if (draftAt !== seenDraftAt) {
    setSeenDraftAt(draftAt);
    if (item.draft && (redraftTaskId !== null || !edited)) {
      setText(item.draft.text);
      setEdited(false);
      if (redraftTaskId !== null) setRedraftApplied(true);
    }
  }

  // The redraft settled: read the queue, which carries the new draft (or shows the
  // letter moved). The task result says only WHETHER a draft was stored, never the text.
  useEffect(() => {
    if (redraft === "saved" || redraft === "notSaved" || redraft === "unknown") onChanged();
  }, [redraft, onChanged]);

  const length = letterLength(text);
  const closeOnly = item.closeOnly;
  const outcome = item.outcome === "hired" ? t("outcomeHired") : t("outcomeNotSelected");
  const language = isLocale(item.lang) ? tLanguage(item.lang) : item.lang;

  const run = async (action: Action) => {
    setBusy(action);
    setFailure(null);
    setRedraftApplied(false);
    try {
      let result: LetterDoorResult;
      try {
        const r = await fetch(`/api/decisions/feedback-letters/${encodeURIComponent(item.id)}/${action}`, {
          method: "POST",
          ...(action === "approve"
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finalText: text }) }
            : {}),
        });
        // A proxy's HTML error page is not a reason to lose the status.
        result = foldLetterDoor({ ok: r.ok, status: r.status }, await r.json().catch(() => null));
      } catch {
        // Never landed (offline, aborted). Folded, never thrown: a silent click is the
        // failure this editor exists to avoid.
        result = foldLetterDoor(null, null);
      }
      if (!result.ok) {
        setFailure(result.failure);
        if (failureStalesQueue(result.failure)) onChanged();
        return;
      }
      if (action === "redraft") {
        setRedraftTaskId(result.taskId);
        return;
      }
      setDone(action === "approve" ? { kind: "approved", delivery: result.delivery } : { kind: "declined", closeOnly: closeOnly !== null });
      onChanged();
    } finally {
      setBusy(null);
      setConfirmingDecline(false);
    }
  };

  const notice = done?.kind === "approved" && done.delivery ? deliveryNotice(done.delivery) : null;
  // Literal keys (next-intl types them; a template-literal key would not compile), one per
  // sentence deliveryNotice can pick.
  const noticeCopy: Record<DeliveryNoticeKey | ReadabilityNoticeKey, string> = {
    doneSent: t("editor.doneSent"),
    doneQueued: t("editor.doneQueued"),
    doneFailed: t("editor.doneFailed"),
    doneSuppressed: t("editor.doneSuppressed"),
    doneReadable: t("editor.doneReadable"),
    doneUnreadable: t("editor.doneUnreadable"),
  };

  return (
    <Modal
      title={t("editor.title", { name: item.candidateLabel ?? t("candidateUnknown") })}
      subtitle={t("editor.meta", { role: item.jobTitle ?? "—", outcome, date: date(item.requestedAt) })}
      onClose={onClose}
      size="2xl"
      footer={
        done ? (
          <button type="button" onClick={onClose} className={`${BTN_SECONDARY} h-10 px-4`}>
            {t("editor.close")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmingDecline(true)}
              disabled={busy !== null || confirmingDecline}
              className={`${BTN_GHOST} mr-auto h-10 px-3`}
            >
              {t("editor.decline")}
            </button>
            {closeOnly ? null : (
              <>
                <button
                  type="button"
                  onClick={() => void run("redraft")}
                  disabled={busy !== null || redraft === "running"}
                  className={`${BTN_SECONDARY} h-10 px-4`}
                >
                  {t("editor.redraft")}
                </button>
                <button
                  type="button"
                  onClick={() => void run("approve")}
                  disabled={busy !== null || length.problem !== null}
                  className={`${BTN_AFFIRM} h-10 px-4`}
                >
                  {busy === "approve" ? t("editor.approving") : t("editor.approve")}
                </button>
              </>
            )}
          </>
        )
      }
    >
      {done ? (
        <div role="status" className="space-y-2 text-base text-ink">
          {done.kind === "declined" ? <p>{done.closeOnly ? t("editor.doneClosed") : t("editor.doneDeclined")}</p> : null}
          {done.kind === "approved" && notice ? (
            <>
              <p>{noticeCopy[notice.email]}</p>
              <p className="text-steel">{noticeCopy[notice.page]}</p>
            </>
          ) : null}
          {/* The approval landed but its delivery report did not parse: say what is known
              and where to look, never a guessed "sent". */}
          {done.kind === "approved" && !notice ? <p>{t("editor.doneUnknown")}</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {closeOnly ? (
            <p role="status" className={`${NOTICE("amber")} px-3 py-2 text-sm`}>
              {closeOnly === "consent_withheld" ? t("editor.closeOnlyConsent") : t("editor.closeOnlyGone")}
            </p>
          ) : (
            <>
              <div className="space-y-1 text-sm text-steel">
                <p>
                  {item.draft?.source === "model"
                    ? t("editor.sourceModel")
                    : item.draft
                      ? t("editor.sourceTemplate")
                      : t("editor.sourceNone")}
                </p>
                <p>{t("editor.language", { language })}</p>
                <p className="font-semibold text-ink">{t("editor.rule")}</p>
              </div>
              <label className="block">
                <span className="sr-only">{t("editor.label")}</span>
                <TextArea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setEdited(true);
                  }}
                  rows={14}
                  invalid={length.over > 0}
                  aria-describedby={countId}
                  disabled={busy === "approve"}
                />
              </label>
              <div id={countId} className="flex flex-wrap items-baseline justify-between gap-2 text-meta">
                <span className={length.over > 0 ? "font-semibold text-coral" : "text-steel"}>
                  {t("editor.count", { count: length.length, max: length.max })}
                </span>
                {length.over > 0 ? (
                  <span role="alert" className="font-semibold text-coral">
                    {t("editor.over", { over: length.over })}
                  </span>
                ) : null}
              </div>
              {relayConfigured === false ? <p className={`${NOTICE("info")} px-3 py-2 text-sm`}>{t("editor.noRelay")}</p> : null}
              <p className="text-meta text-steel">{t("editor.redraftNote")}</p>
              <TaskFlightNote watch={watch} />
              {redraftApplied ? (
                <p role="status" className="text-sm text-moss">
                  {t("editor.redraftReady")}
                </p>
              ) : null}
              {redraft === "failed" ? (
                <p role="alert" className="text-sm font-semibold text-coral">
                  {t("editor.redraftFailed")}
                </p>
              ) : null}
              {redraft === "notSaved" ? (
                <p role="status" className="text-sm text-steel">
                  {t("editor.redraftNotSaved")}
                </p>
              ) : null}
            </>
          )}
          {confirmingDecline ? (
            <div className={`${NOTICE("critical")} space-y-2 px-3 py-2 text-sm`}>
              <p>{closeOnly ? t("editor.declineConfirmCloseOnly") : t("editor.declineConfirm")}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void run("decline")} disabled={busy !== null} className={`${BTN_SECONDARY} h-9 px-3`}>
                  {busy === "decline" ? t("editor.declining") : t("editor.declineYes")}
                </button>
                <button type="button" onClick={() => setConfirmingDecline(false)} disabled={busy !== null} className={`${BTN_GHOST} h-9 px-3`}>
                  {t("editor.declineNo")}
                </button>
              </div>
            </div>
          ) : null}
          {failure ? (
            <p role="alert" className="text-sm font-semibold text-coral">
              {capabilityAwareReason(errMsg, failure, t("editor.actionFailed"))}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
