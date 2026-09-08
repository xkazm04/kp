"use client";

import { useCallback, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { ChatTranscript, type ChatSide } from "@/app/_components/chat/ChatTranscript";
import { JdsIntakeChoiceCards } from "./JdsIntakeChoiceCards";
import { IntakeVoiceBar } from "./IntakeVoiceBar";
import { compactedTurnCount } from "@/app/_lib/intake-transcript";
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
//
// Decision cards (app/_lib/intake-choices.ts) hang under the agent bubble that
// offered them, through the primitive's `renderTurnExtras` slot — so they are
// marginalia on a turn, not a second conversation surface. Only the NEWEST turn
// is interactive: an older set stays visible as the record of what was offered,
// but re-answering a question three turns back would send a message the
// transcript reads as an answer to the current one.

const intakeSide = (role: string): ChatSide =>
  role === "candidate" ? "right" : role === "system" ? "center" : "left";

/**
 * Add dictated words to whatever is already typed, THROUGH the composer's own
 * state.
 *
 * The composer keeps its draft privately (`ChatComposer`'s `useState`) and the
 * shared `ChatTranscript` exposes exactly two seams to a host: a slot beside Send
 * and a ref to the textarea. There is no "append" prop, and adding one would mean
 * editing both shared files for one caller — so this drives the controlled input
 * the way React itself listens to it: set the value through the NATIVE setter
 * (React installs its own on the element instance, which is why a plain
 * `el.value = …` is invisible to it) and dispatch the `input` event the composer's
 * onChange is already subscribed to. The draft that results is the composer's own
 * state, so Enter, Send and the refused-send restore all behave exactly as if the
 * words had been typed.
 *
 * Dictation APPENDS and never sends: a transcription is a first draft of a
 * sentence, and a mis-heard word must be fixable before it becomes a turn.
 */
function appendToComposer(el: HTMLTextAreaElement | null, text: string): void {
  const words = text.trim();
  if (!el || !words) return;
  const current = el.value.replace(/\s+$/, "");
  const next = current ? `${current} ${words}` : words;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setValue) return;
  setValue.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(next.length, next.length);
}

export function JdsIntakeChat({
  intakeId,
  lang,
  transcript,
  sending,
  closed,
  onSend,
  voiceSlot,
  highlightTurn,
  onHighlightDone,
  statusNote,
}: {
  /** The open session — the dictation/read-aloud pair is per-intake. */
  intakeId: string;
  /** The session's language, for the speech-to-text and text-to-speech calls. */
  lang: string;
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
  // The stored transcript is capped at the engine's own prompt window, and the
  // compaction it did is DISCLOSED rather than hidden: the leading marker turn
  // carries a machine token (`kp:transcript-compacted:<n>`) which resolves here
  // into the reader's language. A transcript that silently began mid-sentence
  // would read as data loss; saying how many turns rolled off does not.
  const turns = useMemo(
    () =>
      transcript.map((turn, i) => {
        const compacted = compactedTurnCount(turn);
        return {
          id: String(i),
          role: turn.role,
          content: compacted > 0 ? t("compactedNote", { count: compacted }) : turn.text,
        };
      }),
    [transcript, t]
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const onDictated = useCallback((text: string) => appendToComposer(composerRef.current, text), []);
  // What read-aloud offers to speak: the agent's newest line. Null while a turn is
  // in flight — the reply on screen is the PREVIOUS one, and speaking it while the
  // next is being written would read the conversation back out of order.
  const speakText = useMemo(() => {
    if (sending) return null;
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const turn = transcript[i];
      if (turn?.role === "interviewer" && turn.text.trim()) return turn.text;
    }
    return null;
  }, [transcript, sending]);
  const lastIndex = transcript.length - 1;
  const renderTurnExtras = useCallback(
    (turn: { id: string }) => {
      const index = Number(turn.id);
      const set = transcript[index]?.choices;
      if (!set) return null;
      return (
        <JdsIntakeChoiceCards
          set={set}
          disabled={closed || sending || index !== lastIndex}
          onPick={onSend}
          // "None of these" is not a no-op: it hands the turn to the composer,
          // where the requestor answers in their own words — which is what the
          // card set was an alternative to, never a replacement for.
          onDecline={() => composerRef.current?.focus()}
        />
      );
    },
    [transcript, closed, sending, lastIndex, onSend]
  );

  return (
    <ChatTranscript
      renderTurnExtras={renderTurnExtras}
      composerRef={composerRef}
      // The desk owns the height (JdsIntakeLayoutTriptych): the transcript fills
      // the leaf it is given rather than standing at the primitive's default
      // 32rem, which is what left dead space beside a taller brief.
      className="h-full min-h-0"
      turns={turns}
      side={intakeSide}
      labels={labels}
      busy={sending}
      closed={closed}
      onSend={onSend}
      statusNote={statusNote}
      composerSlot={
        <>
          {voiceSlot}
          {/* The keyless voice PAIR (WP2 fills it in; it draws nothing until
              then): dictation into the draft and read-aloud of the agent's line.
              It sits beside the full-call relay control rather than replacing it —
              one is "type by speaking", the other is "have the conversation
              aloud". Hidden on a closed session, which has no composer to fill. */}
          {!closed ? (
            <IntakeVoiceBar intakeId={intakeId} lang={lang} onDictated={onDictated} speakText={speakText} disabled={sending} />
          ) : null}
        </>
      }
      highlightId={highlightTurn == null ? null : String(highlightTurn)}
      onHighlightDone={onDone}
    />
  );
}
