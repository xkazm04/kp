"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Mic, Sparkles, User } from "lucide-react";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import type { Phase } from "./ui-types";
import { foldTranscript, shouldFollow, turnKey } from "./transcript-follow";

export function VoiceTranscript({
  turns,
  phase,
  awaitingMic,
  candidateLabel,
  jobTitle,
}: {
  turns: VoiceTurn[];
  phase: Phase;
  awaitingMic: boolean;
  candidateLabel?: string;
  jobTitle?: string;
}) {
  const t = useTranslations("interview.voice");
  const logRef = useRef<HTMLDivElement | null>(null);

  // Follow the newest turn — but ONLY while the reader is already at the tail.
  // This ran unconditionally on every append, so a candidate who scrolled up to
  // re-read the question they were answering was yanked back to the bottom the
  // moment the next transcription landed, mid-call, with no way to hold their
  // place. The decision is taken from the reader's OWN scrolling (below) rather
  // than re-measured after an append: by then the element is already taller, so
  // every reader would measure as "scrolled up" and the log would follow nobody.
  const followRef = useRef(true);
  const onScroll = () => {
    const el = logRef.current;
    if (el) followRef.current = shouldFollow(el.scrollTop, el.scrollHeight, el.clientHeight);
  };
  useEffect(() => {
    const el = logRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // The log grew without bound — every turn mounted, and each one announced by the
  // aria-live region. Render the newest window and SAY how many are folded above;
  // the full transcript is persisted server-side and shown on the scorecard.
  const { visible, folded } = foldTranscript(turns);

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <p className="flex items-center gap-2 text-meta uppercase text-steel">
          {t("liveTranscript")}
          {phase === "live" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-coral">
              <span className="voice-listen h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> {t("liveBadge")}
            </span>
          ) : null}
        </p>
        {candidateLabel || jobTitle ? (
          <p className="truncate pl-2 text-meta text-steel">
            {candidateLabel}
            {candidateLabel && jobTitle ? " · " : ""}
            {jobTitle}
          </p>
        ) : null}
      </div>
      <div
        ref={logRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={t("transcriptLabel")}
        className="max-h-[520px] space-y-4 overflow-y-auto scroll-smooth p-4"
      >
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-paper text-steel">
              <Mic size={20} aria-hidden />
            </span>
            <div>
              {/* Phase-aware: the idle "Press Start" copy contradicted the live phases
                  (it showed even while Connecting/Live/Ending with no turns yet). */}
              {phase === "connecting" ? (
                <p className="text-base text-ink">{awaitingMic ? t("awaitingMic") : t("connecting")}</p>
              ) : phase === "live" ? (
                <p className="text-base text-ink">{t("listeningFirst")}</p>
              ) : phase === "ending" ? (
                <p className="text-base text-ink">{t("wrappingUp")}</p>
              ) : (
                <>
                  <p className="text-base text-ink">{t("transcriptEmpty")}</p>
                  <p className="mt-1 text-sm text-steel">{t("transcriptHint")}</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {folded > 0 ? (
              <p className="text-center text-sm text-steel">{t("transcriptFolded", { count: folded })}</p>
            ) : null}
            {visible.map((placed) =>
              placed.turn.role === "system" ? (
                <p key={turnKey(placed)} className="text-center text-sm text-steel">
                  {placed.turn.text}
                </p>
              ) : (
                <TranscriptTurn key={turnKey(placed)} role={placed.turn.role} text={placed.turn.text} />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TranscriptTurn({ role, text }: { role: "candidate" | "interviewer"; text: string }) {
  const t = useTranslations("interview.voice");
  const isCandidate = role === "candidate";
  return (
    <div className={`flex items-start gap-2.5 ${isCandidate ? "flex-row-reverse" : ""}`}>
      <span
        aria-hidden
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
          isCandidate ? "bg-limewash text-moss" : "bg-ink text-white"
        }`}
      >
        {isCandidate ? <User size={14} /> : <Sparkles size={14} />}
      </span>
      <div className={`min-w-0 max-w-[82%] ${isCandidate ? "text-right" : ""}`}>
        <p className="text-meta uppercase text-steel">{isCandidate ? t("turnYou") : t("turnInterviewer")}</p>
        <p
          className={`mt-1 inline-block rounded-2xl px-3.5 py-2 text-left text-base leading-6 ${
            isCandidate
              ? "rounded-tr-sm bg-limewash text-ink"
              : "rounded-tl-sm border border-stone-200 bg-paper text-ink"
          }`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}
