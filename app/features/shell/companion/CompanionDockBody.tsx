"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { ChatTranscript, type ChatSide, type ChatTurn } from "@/app/_components/chat/ChatTranscript";
import { ChatBlocks } from "@/app/_components/chat/ChatBlocks";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { BTN_GHOST, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { renderableBlocks } from "@/app/_lib/companion-blocks";
import { companionFallbackClass } from "@/app/_lib/companion-turn";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { CompanionProposal, CompanionTurn, CompanionTurnMeta } from "@/app/_lib/db/companion";
import type { AttentionCounts } from "@/app/features/shell/useAttention";
import { CompanionProposalCard } from "./CompanionProposalCard";
import { CompanionSpeakButton } from "./CompanionSpeakButton";
import { voiceTextForTurn, type CompanionSpeech } from "./useCompanionSpeech";

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
 *
 * V1 adds a third: every reply also carries a SPOKEN form (`meta.voiceReply`),
 * and the marginalia carries the control that plays it. A colleague you can ask
 * to say it out loud, in the same quiet register as the rest of the strip — not
 * a media player bolted to the dock.
 *
 * Round V2 HANDS the speech seam in rather than making one. There is now a
 * second shape (voice mode) and a setting that speaks a reply the moment it
 * lands, and both are the same utterance: a hook mounted per presentation would
 * have been two of them, and "at most one thing is audible" is the one promise
 * `useCompanionSpeech` exists to keep. The owner is `CompanionDock`.
 */

const companionSide = (role: string): ChatSide => (role === "user" ? "right" : "left");
const RECALL_CHIPS = 2;

export type CompanionBodyProps = {
  turns: CompanionTurn[];
  /** Every proposal this conversation produced, live from the server. */
  proposals: CompanionProposal[];
  busy: boolean;
  /** Machine error code from the route, resolved to a message at the door. */
  error: string | null;
  /** Live studio facts — the same counts behind the sidebar badges. */
  attention: AttentionCounts | null;
  /** Whether this workspace has consented to Candi keeping a memory on this
   *  machine (WP4). False is a legitimate, working state — she answers, she just
   *  does not recall or record — and it is SAID rather than left to be inferred
   *  from an answer that keeps forgetting last week. */
  memoryEnabled: boolean;
  /** The companion's ONE spoken channel, owned by CompanionDock and shared with
   *  voice mode. Not created here: at most one utterance is audible at a time,
   *  and that is only true while there is one hook. */
  speech: CompanionSpeech;
  onSend: (message: string) => Promise<boolean>;
  onResolveProposal: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  /** The proposal whose answer did not land, and why. It is drawn on that card
   *  rather than in the line below, because the operator pressed a button on one
   *  row and the sentence about it has to be readable from there. */
  proposalError: { id: string; code: string } | null;
  /** The message whose exchange did not land. Present means the error line can
   *  offer to send it again; the composer is holding the same text as a draft. */
  lastFailed: string | null;
  onRetry: () => Promise<boolean>;
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
  focusOnMount = false,
}: {
  onOpen: () => void;
  /** A turn is still in flight after the operator collapsed the dock. */
  busy: boolean;
  /** A reply landed while the dock was closed. */
  unread: boolean;
  label: string;
  /** The operator just CLOSED the window, so keyboard focus was inside it and is
   *  about to be nowhere. Take it here — the pill is where the window went. Only
   *  on that transition: a page that loads with the dock closed must not steal
   *  focus from wherever the operator actually is. */
  focusOnMount?: boolean;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  // Only ever true on the render that follows an operator CLOSE — the pill mounts
  // already carrying it, and opening unmounts the pill again — so this fires once,
  // on the transition it is named for, and never as a later grab.
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <button
      ref={ref}
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

export function CompanionBody({
  turns,
  proposals,
  busy,
  error,
  attention,
  memoryEnabled,
  speech,
  onSend,
  onResolveProposal,
  proposalError,
  lastFailed,
  onRetry,
}: CompanionBodyProps) {
  const t = useTranslations("companion");
  const resolveError = useErrorMessage();
  const metaById = useMemo(() => new Map(turns.map((turn) => [turn.id, turnMeta(turn)])), [turns]);
  // Proposals are joined onto their turn by ID, never by position or timestamp:
  // one exchange can carry two, a thread carries many, and the row the operator
  // is answering must be the one the sentence above it offered.
  const proposalById = useMemo(() => new Map(proposals.map((p) => [p.id, p])), [proposals]);
  // Whether the LAST answer reached the brain. `indexSkipped` names the episode
  // files that were written to disk but not indexed, so recall will not find them
  // — the engine has always reported it and nothing has ever shown it. It is the
  // newest assistant turn's fact, not the thread's: one blocked write does not
  // make a conversation memoryless, and saying so on every later turn would be
  // its own small lie.
  const memoryNotWritten = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role !== "assistant") continue;
      return (turnMeta(turns[i]).indexSkipped ?? []).length > 0;
    }
    return false;
  }, [turns]);
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
  const metaLabels = useMemo(
    () => ({
      digest: t("meta.digest"),
      degraded: t("meta.degraded"),
      degradedNoProvider: t("meta.degradedNoProvider"),
      degradedProviderFailed: t("meta.degradedProviderFailed"),
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
        {/* One quiet line under the state, not a banner: a memoryless Candi is
            working software, so the fact belongs in the same register as
            "watching 3 things" rather than dressed as a fault. It names where
            the switch is, because a limitation with no stated remedy just reads
            as a defect. */}
        {memoryEnabled ? null : <p className="text-sm text-steel">{t("state.memoryOff")}</p>}
        {/* Consent is on and the write still did not land: a different fact, and
            the only one of the two the operator cannot fix in setup. Same quiet
            register as the line above — she answered, the answer just will not be
            there next week. */}
        {memoryEnabled && memoryNotWritten ? (
          <p className="text-sm text-steel">{t("state.memoryNotWritten")}</p>
        ) : null}
      </div>
      {/* An assertive live region, and OUTSIDE the transcript's polite one: a
          failure is the one thing here a screen reader must hear now rather than
          after whatever else is being announced. The Retry re-sends the refused
          message; the composer is holding the same text, so this is the cheap
          path and typing it again is still the other one. */}
      {error && !proposalError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 pb-2">
          <p className="text-sm text-coral">{resolveError({ code: error }, t("chat.errorGeneric"))}</p>
          {lastFailed ? (
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={busy}
              className={`${BTN_GHOST} h-7 px-2 text-sm`}
            >
              {t("chat.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <ChatTranscript
        className="min-h-0 flex-1"
        tall
        turns={chatTurns}
        side={companionSide}
        labels={labels}
        busy={busy}
        onSend={onSend}
        emptyState={<Greeting text={t("greeting")} />}
        renderTurnExtras={(turn) => {
          if (turn.role !== "assistant") return null;
          const speakable = { id: turn.id, content: turn.content, meta: metaById.get(turn.id) };
          return (
            <TurnExtras
              t={t}
              meta={metaById.get(turn.id)}
              metaLabels={metaLabels}
              blockLabels={blockLabels}
              proposalById={proposalById}
              onResolveProposal={onResolveProposal}
              proposalError={proposalError}
              // Offered only when there is genuinely something to say: the door
              // has already run over this turn, so an empty answer means an empty
              // utterance, and a control that would do nothing is not drawn.
              speakSlot={
                voiceTextForTurn(speakable) ? <CompanionSpeakButton turn={speakable} speech={speech} /> : null
              }
            />
          );
        }}
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
 *  OFFERED, then what she stood on.
 *
 *  The proposals sit between the drawing and the marginalia deliberately. They
 *  are the only part of a turn the operator has to answer, so they belong where
 *  the eye lands after the content and before the provenance — a card under the
 *  recall chips would read as a footnote to a citation. A dropped block or a
 *  dropped proposal is admitted rather than hidden: the operator is entitled to
 *  know something was attempted and did not survive. */
function TurnExtras({
  t,
  meta,
  metaLabels,
  blockLabels,
  proposalById,
  onResolveProposal,
  proposalError,
  speakSlot,
}: {
  t: ReturnType<typeof useTranslations<"companion">>;
  meta: CompanionTurnMeta | undefined;
  /** The four provenance strings this row can print, resolved once by the body
   *  rather than per turn — a transcript is many turns and they are all the same
   *  four sentences. */
  metaLabels: { digest: string; degraded: string; degradedNoProvider: string; degradedProviderFailed: string };
  blockLabels: ChatBlockLabels;
  proposalById: Map<string, CompanionProposal>;
  onResolveProposal: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  proposalError: { id: string; code: string } | null;
  /** The play control for this reply's spoken form, or null when there is
   *  nothing speakable. It rides in the chip row rather than beside the bubble
   *  so the whole strip stays one line of marginalia. */
  speakSlot?: ReactNode;
}) {
  // Blocks are re-coerced at the point of DRAWING (a stored turn is untrusted
  // input however it was typed on the way in) and the drop count is the
  // server's PLUS whatever did not survive that coercion — the one half of the
  // counted-discard rule the code was not keeping.
  const { blocks, blockErrors: dropped } = renderableBlocks(meta);
  const droppedActions = meta?.actionErrors ?? 0;
  // What she REMEMBERED, as insight rather than transcript. The strip prints the
  // CLI's short `insight` form and nothing else: a hit that carries none grounded
  // the answer without teaching anything, and an empty strip says that honestly.
  // Round 5 replaced a raw-excerpt dump here that was echoing the operator's own
  // commands back at them ("remembered: Please prepare a digest…"); a turn stored
  // before that change carries no insight and correctly shows no chip.
  const recall = (meta?.recallUsed ?? []).filter((hit) => (hit.insight ?? "").trim().length > 0);
  const isDegraded = meta?.source === "deterministic";
  // WHY it degraded, not just THAT it did. "No model configured" is a settings
  // trip and "the model did not answer" is worth one retry; the single generic
  // chip made an operator on a keyless install retry forever. An unrecognised
  // reason keeps that generic chip rather than being guessed at.
  const fallbackClass = isDegraded ? companionFallbackClass(meta?.fallbackReason) : null;
  const degradedLabel = !isDegraded
    ? null
    : fallbackClass === "noProvider"
      ? metaLabels.degradedNoProvider
      : fallbackClass === "providerFailed"
        ? metaLabels.degradedProviderFailed
        : metaLabels.degraded;
  // The one turn nobody asked for. Labelled, because an unannounced paragraph
  // that appears above your own last message reads as a reply to it.
  const isDigest = meta?.digest === true;
  // Ids the turn CLAIMS, resolved against the live rows: a proposal id that no
  // longer resolves (a restored database, a hand-deleted row) renders nothing
  // rather than a card with no content.
  const proposals = (meta?.proposalIds ?? [])
    .map((id) => proposalById.get(id))
    .filter((p): p is CompanionProposal => p !== undefined);
  if (
    blocks.length === 0 &&
    dropped === 0 &&
    droppedActions === 0 &&
    proposals.length === 0 &&
    recall.length === 0 &&
    !isDegraded &&
    !isDigest &&
    !speakSlot
  ) {
    return null;
  }
  return (
    <>
      <ChatBlocks blocks={blocks} labels={blockLabels} />
      {proposals.map((proposal) => (
        <CompanionProposalCard
          key={proposal.id}
          proposal={proposal}
          onResolve={onResolveProposal}
          error={proposalError?.id === proposal.id ? proposalError.code : null}
        />
      ))}
      <div className="mt-1.5 flex max-w-[85%] flex-wrap items-center gap-1.5">
        {isDigest ? <span className={`${CHIP_QUIET} text-ink`}>{metaLabels.digest}</span> : null}
        {speakSlot}
        {degradedLabel ? <span className={`${CHIP_QUIET} text-coral`}>{degradedLabel}</span> : null}
        {dropped > 0 ? <span className={CHIP_QUIET}>{t("blocks.dropped", { count: dropped })}</span> : null}
        {droppedActions > 0 ? (
          <span className={CHIP_QUIET}>{t("proposal.dropped", { count: droppedActions })}</span>
        ) : null}
        {recall.slice(0, RECALL_CHIPS).map((hit) => (
          <span key={hit.path} className={CHIP_QUIET}>
            {t("meta.remembered")} {hit.insight}
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
  // Her OWN queue comes first. Every other count here is something the studio is
  // waiting on; open proposals are something SHE is waiting on, and the answer is
  // one scroll up in this same column. That is also the whole reason this count
  // exists as its own attention key rather than being folded into `decisions`:
  // the nav badge and the ControlDock beacon both route to the Decisions tab,
  // which has no affordance that can resolve a proposal.
  if (attention.companion > 0) return t("state.proposals", { count: attention.companion });
  const waiting = decisions + attention.pipeline;
  return waiting > 0 ? t("state.watching", { count: waiting }) : t("state.clear");
}
