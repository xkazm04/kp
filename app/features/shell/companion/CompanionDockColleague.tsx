"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { ChatTranscript, type ChatSide, type ChatTurn } from "@/app/_components/chat/ChatTranscript";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CompanionTurnMeta } from "@/app/_lib/db/companion";
import { turnMeta, type CompanionRestProps, type CompanionVariantProps } from "./companionVariants";

/*
 * VARIANT A — "Colleague" (editorial / identity metaphor).
 *
 * Candi is a person you share an office with, not a console. The dock leads with
 * her NAME in the display face and one honest line about what she is holding
 * right now ("thinking about 3 decisions…"), drawn from the same attention
 * counts the sidebar badges use. The transcript is a conversation, not a log:
 * roomy bubbles, no timestamps, no provenance chrome in the reading path.
 * What she REMEMBERED is marginalia — quiet chips under her own bubble, the way
 * a colleague says "you told me last week…" rather than citing a source id.
 * Rest state is a small pill with her mark: an office door, not a second orb.
 *
 * Differs from Desk: identity and warmth carry the surface; the machinery
 * (model, recall count, fallback) is deliberately below the reading line.
 */

const companionSide = (role: string): ChatSide => (role === "user" ? "right" : "left");
const RECALL_CHIPS = 2;
const EXCERPT_CHARS = 80;

export function ColleagueRest({ onOpen, busy, unread, label }: CompanionRestProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="focus-ring fixed bottom-[calc(var(--sim-bar-h)_+_8px)] right-3 z-[var(--z-sim-drawer)] inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white py-2 pl-2 pr-4 shadow-pop transition-colors hover:border-coral/40 dark:-rotate-1 dark:hover:rotate-0"
    >
      <span className="relative grid h-8 w-8 place-items-center">
        <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
        {unread || busy ? (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-coral ring-2 ring-white" />
        ) : null}
      </span>
      <span className="text-sm font-semibold text-ink">{label}</span>
    </button>
  );
}

export function CompanionColleague({ turns, busy, error, attention, onSend }: CompanionVariantProps) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const metaById = useMemo(() => new Map(turns.map((turn) => [turn.id, turnMeta(turn)])), [turns]);
  const chatTurns = useMemo<ChatTurn[]>(
    () => turns.map((turn) => ({ id: turn.id, role: turn.role, content: turn.content })),
    [turns]
  );
  const labels = useMemo(
    () => ({
      thinking: t("chat.thinking"),
      thinkingSlow: t("chat.thinkingSlowCalm"),
      placeholder: t("chat.placeholder"),
      send: t("chat.send"),
      transcriptLabel: t("chat.transcriptLabel"),
    }),
    [t]
  );

  return (
    <>
      <div className="pb-3">
        <h2 className="font-serif text-h2 leading-tight text-ink">{t("name")}</h2>
        <p className="text-sm text-steel">{stateLine(t, busy, attention)}</p>
      </div>
      {error ? <p className="pb-2 text-sm text-coral">{resolveError({ code: error }, t("chat.errorGeneric"))}</p> : null}
      <ChatTranscript
        className="min-h-0 flex-1"
        turns={chatTurns}
        side={companionSide}
        labels={labels}
        busy={busy}
        onSend={onSend}
        emptyState={<Greeting text={t("greeting")} />}
        renderTurnExtras={(turn) =>
          turn.role === "assistant" ? <Marginalia meta={metaById.get(turn.id)} remembered={t("meta.remembered")} degraded={t("meta.degraded")} /> : null
        }
      />
    </>
  );
}

/** Her first words. Written in the constitution's register — an offer of help
 *  with an explicit limit, because she proposes and never acts. */
function Greeting({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 pt-1">
      <KandidateMark className="mt-0.5 h-7 w-7 shrink-0 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-stone-100 px-3.5 py-2.5 text-body text-ink dark:rounded-2xl">{text}</p>
    </div>
  );
}

/** What she recalled, in the margin. Two chips at most: a colleague references a
 *  memory, they do not read out the index. A degraded turn says so in the same
 *  quiet voice rather than pretending the answer was hers. */
function Marginalia({ meta, remembered, degraded }: { meta: CompanionTurnMeta | undefined; remembered: string; degraded: string }) {
  const recall = meta?.recallUsed ?? [];
  const isDegraded = meta?.source === "deterministic";
  if (recall.length === 0 && !isDegraded) return null;
  return (
    <div className="mt-1.5 flex max-w-[85%] flex-wrap items-center gap-1.5">
      {isDegraded ? <span className={`${CHIP_QUIET} text-coral`}>{degraded}</span> : null}
      {recall.slice(0, RECALL_CHIPS).map((hit) => (
        <span key={hit.path} className={CHIP_QUIET} title={hit.excerpt}>
          {remembered} {hit.excerpt.slice(0, EXCERPT_CHARS)}
        </span>
      ))}
    </div>
  );
}

/** One honest line about what she is holding — real counts, never a mood. */
function stateLine(
  t: ReturnType<typeof useTranslations<"companion">>,
  busy: boolean,
  attention: CompanionVariantProps["attention"]
): string {
  const decisions = attention?.decisions ?? 0;
  if (busy) return decisions > 0 ? t("state.thinkingAbout", { count: decisions }) : t("state.thinking");
  if (!attention) return t("state.here");
  const waiting = decisions + attention.pipeline;
  return waiting > 0 ? t("state.watching", { count: waiting }) : t("state.clear");
}
