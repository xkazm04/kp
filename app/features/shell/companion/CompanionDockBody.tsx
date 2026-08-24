"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { ChatTranscript, type ChatSide, type ChatTurn } from "@/app/_components/chat/ChatTranscript";
import { ChatBlocks } from "@/app/_components/chat/ChatBlocks";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CompanionTurn, CompanionTurnMeta } from "@/app/_lib/db/companion";
import type { AttentionCounts } from "@/app/features/shell/useAttention";

/*
 * The dock's body — the round-1 "Colleague" direction, promoted to the only one.
 *
 * Candi is a person you share an office with, not a console. The body leads with
 * her NAME in the display face and one honest line about what she is holding
 * right now ("thinking about 3 decisions…"), drawn from the same attention
 * counts the sidebar badges use. The transcript is a conversation, not a log:
 * roomy bubbles, no timestamps, no provenance chrome in the reading path. What
 * she REMEMBERED is marginalia — quiet chips under her own bubble, the way a
 * colleague says "you told me last week…" rather than citing a source id.
 *
 * Round 2 makes the non-text turn first-class: when the answer is three or more
 * comparable things, she composes a TABLE or a small CHART instead of listing
 * them in prose, and it renders under her bubble as a real rendered artifact.
 * That is why the marginalia sits BELOW the blocks — the recall chips annotate
 * the whole answer, and the answer now has two halves.
 */

const companionSide = (role: string): ChatSide => (role === "user" ? "right" : "left");
const RECALL_CHIPS = 2;
const EXCERPT_CHARS = 80;

export type CompanionBodyProps = {
  turns: CompanionTurn[];
  busy: boolean;
  /** Machine error code from the route, resolved to a message at the door. */
  error: string | null;
  /** Live studio facts — the same counts behind the sidebar badges. */
  attention: AttentionCounts | null;
  onSend: (message: string) => Promise<boolean>;
};

/** Turn provenance, read from the stored meta without asserting past it: an
 *  unrecognised shape yields an empty record rather than a confident lie. */
function turnMeta(turn: CompanionTurn): CompanionTurnMeta {
  return turn.meta ?? {};
}

/** The collapsed state: an office door, not a second orb. It rests at the BOTTOM
 *  OF THE NAV PANEL — where the window itself will open — and clears the 4.75rem
 *  icon rail so it can never sit on top of the appearance controls. Below md the
 *  sidebar is off-canvas, so it moves to the screen edge. */
export function CompanionRest({
  onOpen,
  busy,
  unread,
  label,
}: {
  onOpen: () => void;
  /** A turn is still in flight after the operator collapsed the dock. */
  busy: boolean;
  /** A reply landed while the dock was closed. */
  unread: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="focus-ring fixed bottom-[calc(var(--sim-bar-h)_+_8px)] left-3 z-[var(--z-sim-drawer)] inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white py-2 pl-2 pr-4 shadow-pop transition-colors hover:border-coral/40 md:left-[5.25rem] dark:-rotate-1 dark:hover:rotate-0"
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

export function CompanionBody({ turns, busy, error, attention, onSend }: CompanionBodyProps) {
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
  const blockLabels = useMemo<ChatBlockLabels>(
    () => ({ table: t("blocks.table"), chart: t("blocks.chart"), emptyCell: t("blocks.emptyCell") }),
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
          turn.role === "assistant" ? (
            <TurnExtras t={t} meta={metaById.get(turn.id)} blockLabels={blockLabels} />
          ) : null
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

/** Everything under one answer, in reading order: what she DREW, then what she
 *  stood on. A dropped block is admitted rather than hidden — the operator is
 *  entitled to know a comparison was attempted and did not survive. */
function TurnExtras({
  t,
  meta,
  blockLabels,
}: {
  t: ReturnType<typeof useTranslations<"companion">>;
  meta: CompanionTurnMeta | undefined;
  blockLabels: ChatBlockLabels;
}) {
  const blocks = meta?.blocks ?? [];
  const dropped = meta?.blockErrors ?? 0;
  const recall = meta?.recallUsed ?? [];
  const isDegraded = meta?.source === "deterministic";
  if (blocks.length === 0 && dropped === 0 && recall.length === 0 && !isDegraded) return null;
  return (
    <>
      <ChatBlocks blocks={blocks} labels={blockLabels} />
      <div className="mt-1.5 flex max-w-[85%] flex-wrap items-center gap-1.5">
        {isDegraded ? <span className={`${CHIP_QUIET} text-coral`}>{t("meta.degraded")}</span> : null}
        {dropped > 0 ? <span className={CHIP_QUIET}>{t("blocks.dropped", { count: dropped })}</span> : null}
        {recall.slice(0, RECALL_CHIPS).map((hit) => (
          <span key={hit.path} className={CHIP_QUIET}>
            {t("meta.remembered")} {hit.excerpt.slice(0, EXCERPT_CHARS)}
          </span>
        ))}
      </div>
    </>
  );
}

/** One honest line about what she is holding — real counts, never a mood. */
function stateLine(
  t: ReturnType<typeof useTranslations<"companion">>,
  busy: boolean,
  attention: AttentionCounts | null
): string {
  const decisions = attention?.decisions ?? 0;
  if (busy) return decisions > 0 ? t("state.thinkingAbout", { count: decisions }) : t("state.thinking");
  if (!attention) return t("state.here");
  const waiting = decisions + attention.pipeline;
  return waiting > 0 ? t("state.watching", { count: waiting }) : t("state.clear");
}
