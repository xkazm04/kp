"use client";

// The email tool (round 4) — ONE candidate's held outreach letter and their thread, what the
// `letter` panel draws in its `pane` look. Two columns from 900px of its own width: the
// letter as a release would SEND it (subject, recipient, body with the legal footers, the
// delivery forecast, state + revision) and its one next act (Approve a draft / Send an
// approved one) | what was already sent to them, with the one delivery verdict per message.
//
// The acts arm PREVIEW consent cards (consent/acts.ts PREVIEW_ACTS) — nothing is written.
// Only the first-contact outreach letter is held for approval today; rejection and interview
// letters are not drafts a person approves, so this tool never shows one as held.
import { useTranslations } from "next-intl";
import { Button, Mark, Note, Tag, type MarkKind } from "@/app/_components/kit";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { CommsVerdict } from "@/app/_lib/comms-view";
import type { PanelProps } from "../panels/types";
import { letterNextAct, type HeldLetter, type LetterPreview, type ThreadMessage } from "./parse";

const VERDICT_MARK: Record<CommsVerdict, MarkKind> = {
  sent: "ok",
  queued: "wait",
  failed: "fail",
  bounced: "bounce",
  recovered: "recovered",
  orphaned: "unknown",
};

/** The params a letter act carries — the exact revision the person is reading. */
export function letterActParams(l: HeldLetter, label: string): Record<string, string> {
  return { entryId: l.entryId, letterId: l.id, revision: String(l.revision), label };
}

/** The letter's one next act as a button (or nothing for a sent / discarded / erased one). */
export function LetterAct({ letter, label, onPropose, size = "sm" }: { letter: HeldLetter; label: string; onPropose: PanelProps["onPropose"]; size?: "sm" | "md" }) {
  const t = useTranslations("one.core.panels.letter");
  const next = letterNextAct(letter);
  if (!next) return null;
  return next === "approve" ? (
    <Button label={t("approve")} variant="primary" size={size} icon="check" onClick={() => onPropose("letterApprove", letterActParams(letter, label))} data-act="letter-approve" />
  ) : (
    <Button label={t("send")} variant="primary" size={size} onClick={() => onPropose("letterSend", letterActParams(letter, label))} data-act="letter-send" />
  );
}

export function Thread({ messages }: { messages: ThreadMessage[] | null }) {
  const t = useTranslations("one.core.panels.letter");
  const tv = useTranslations("one.core.panels.outbox");
  const fmt = useDateFormat();
  if (messages === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-role="one-letter-thread">
      <p className={META_LABEL}>
        {t("thread")} {messages.length > 0 ? <span className="k-nums">{messages.length}</span> : null}
      </p>
      {messages.length === 0 ? (
        <p className="text-micro text-steel">{t("threadEmpty")}</p>
      ) : (
        <ul className="flex flex-col">
          {messages.map((m) => (
            <li key={m.id} className="flex min-w-0 items-start gap-2 border-b border-stone-200 py-1.5 last:border-b-0 dark:border-dashed">
              <Mark kind={VERDICT_MARK[m.verdict]} tip={tv(`verdict.${m.verdict}`)} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-words text-micro font-semibold text-ink">{m.subject ?? t("noSubject")}</span>
                <span className="text-micro text-steel">
                  {tv(`verdict.${m.verdict}`)} · {fmt.dateTime(m.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The `pane` look: the letter a release would send | the thread. */
export function LetterPane({
  letter,
  preview,
  label,
  thread,
  onPropose,
}: {
  letter: HeldLetter | null;
  preview: LetterPreview | null;
  label: string;
  thread: ThreadMessage[] | null;
  onPropose: PanelProps["onPropose"];
}) {
  const t = useTranslations("one.core.panels.letter");
  const ts = useTranslations("one.core.sample");
  const fmt = useDateFormat();
  const forecast = preview?.forecast ? t(`forecast.${preview.forecast}`) : t("forecast.unknown");
  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto" data-role="one-letter">
      <div className="grid gap-[var(--one-gap)] p-[var(--one-pad)] @min-[900px]:h-full @min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3" data-role="one-letter-reader">
          {letter ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Tag label={t(`state.${letter.state}`)} />
                <span className="k-nums text-micro text-steel">{t("revision", { revision: letter.revision })}</span>
                {letter.createdAt ? <span className="text-micro text-steel">· {fmt.dateTime(letter.updatedAt || letter.createdAt)}</span> : null}
                <span className="ml-auto">
                  <LetterAct letter={letter} label={label} onPropose={onPropose} />
                </span>
              </div>
              {letter.sample ? <Note tone="caution">{ts("note")}</Note> : null}
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-micro">
                <dt className={META_LABEL}>{t("to")}</dt>
                <dd className="min-w-0 break-words text-ink">{preview?.recipient ?? t("noRecipient")}</dd>
                <dt className={META_LABEL}>{t("subject")}</dt>
                <dd className="min-w-0 break-words font-semibold text-ink">{preview?.subject || letter.subject || t("noSubject")}</dd>
              </dl>
              <p className="flex items-start gap-1.5 text-micro text-steel" data-role="one-letter-forecast">
                <Mark kind={preview?.forecast === "relay" ? "ok" : preview?.forecast === "local" ? "wait" : "caution"} />
                <span>{forecast}</span>
              </p>
              {letter.body === null ? (
                <Note tone="caution">{t("erased")}</Note>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <p className={META_LABEL}>{t("sends")}</p>
                  <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-stone-200 bg-stone-50 p-3 dark:rounded-lg" tabIndex={0} aria-label={t("sends")}>
                    <p className="whitespace-pre-wrap break-words text-micro leading-6 text-ink">{preview?.body || letter.body}</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-body text-steel" data-role="one-empty">
                {t("none", { label })}
              </p>
              <p className="text-micro text-steel">{t("heldOnly")}</p>
            </>
          )}
        </div>
        <div className="min-h-0 min-w-0 @min-[900px]:overflow-y-auto">
          <Thread messages={thread} />
        </div>
      </div>
    </div>
  );
}
