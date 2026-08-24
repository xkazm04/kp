"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { ChatTranscript, type ChatSide } from "@/app/_components/chat/ChatTranscript";
import type { IntakeTurn } from "./jdsIntakeLogic";

// The conversation column: transcript bubbles + composer. The agent speaks
// left in a quiet surface; the requestor speaks right on the ink accent
// (text-white flips by design in Spark Dark). Register matches the persona —
// calm, roomy line-height, no avatars, no gamification.
//
// The bubbles, the thinking/slow-hint contract, the autoscroll and the
// send-failure draft restore now live in the shared ChatTranscript primitive
// (app/_components/chat) — this file is the intake ADAPTER: it maps intake's
// role vocabulary onto the primitive's left/right/center sides and supplies the
// `library.tab.intake` copy. Nothing about the rendered surface changed.
//
// Defensibility (UAT drain §2.2): a source-turn chip in the brief panel jumps
// here — `highlightTurn` scrolls the cited bubble into view and flashes it. The
// primitive addresses turns by id, so the transcript INDEX is the id here.
// System turns (e.g. the re-open note) render as a quiet centered line so the
// transcript honestly shows its own seams.

const intakeSide = (role: string): ChatSide =>
  role === "candidate" ? "right" : role === "system" ? "center" : "left";

export function JdsIntakeChat({
  transcript,
  sending,
  closed,
  onSend,
  voiceSlot,
  highlightTurn,
  onHighlightDone,
  statusNote,
}: {
  transcript: IntakeTurn[];
  sending: boolean;
  closed: boolean;
  /** Resolves false when the exchange did NOT land (429/409/offline) — the
   *  composer then hands the typed message back instead of losing it with the
   *  rolled-back optimistic bubble. */
  onSend: (message: string) => void | Promise<boolean>;
  /** Optional extra control rendered beside Send (the voice input mode). */
  voiceSlot?: React.ReactNode;
  /** Transcript index to scroll to + flash (a brief citation was clicked). */
  highlightTurn?: number | null;
  onHighlightDone?: () => void;
  /** A quiet line under the last turn about work happening OUTSIDE the dialog —
   *  today only the App-master repo scan, which runs while the requestor answers
   *  the opener. It is not a transcript turn (nothing said it), so it renders as
   *  a system-style aside and is never stored. */
  statusNote?: string | null;
}) {
  const t = useTranslations("library.tab.intake");
  const turns = useMemo(
    () => transcript.map((turn, i) => ({ id: String(i), role: turn.role, content: turn.text })),
    [transcript]
  );
  const labels = useMemo(
    () => ({
      thinking: t("thinking"),
      thinkingSlow: t("thinkingSlow"),
      placeholder: t("composer.placeholder"),
      send: t("composer.send"),
      closed: t("composer.closed"),
      transcriptLabel: t("composer.transcriptLabel"),
    }),
    [t]
  );
  const onDone = useCallback(() => onHighlightDone?.(), [onHighlightDone]);

  return (
    <ChatTranscript
      turns={turns}
      side={intakeSide}
      labels={labels}
      busy={sending}
      closed={closed}
      onSend={onSend}
      statusNote={statusNote}
      composerSlot={voiceSlot}
      highlightId={highlightTurn == null ? null : String(highlightTurn)}
      onHighlightDone={onDone}
    />
  );
}
