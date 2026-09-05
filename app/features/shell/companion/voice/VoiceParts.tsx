"use client";

import { useTranslations } from "next-intl";
import { ChatBlocks } from "@/app/_components/chat/ChatBlocks";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { renderableBlocks } from "@/app/_lib/companion-blocks";
import type { CompanionProposal } from "@/app/_lib/db/companion";
import { CompanionProposalCard } from "../CompanionProposalCard";
import type { VoiceEntry } from "./voiceHistory";

/*
 * The pieces one answer is made of.
 *
 * They were extracted mid-prototype, when the second of three directions needed
 * the second one. Round V3 kept the Ticker and deleted the other two; these
 * stayed, because they are what an ANSWER is made of rather than what a
 * direction was — and the round-V2 variants that only they served (the prompt
 * echo, the non-compact register) went with the files that used them.
 *
 * The reading order is the dock's, unchanged: what she DREW, what she OFFERED,
 * what she STOOD ON. Voice mode compresses the geometry, not the honesty.
 */

/** Her answer as prose. `clamp` is the strips' whole trick: two lines is a
 *  glance, and the disclosure below is where the rest lives. */
export function VoiceProse({ entry, clamp = false }: { entry: VoiceEntry; clamp?: boolean }) {
  // NO `aria-live` HERE, deliberately. This node is what APPEARS, and a live
  // region inserted together with its first content is announced by nothing: the
  // first answer of a session was silent and only the second onward were read.
  // The permanent wrapper in CompanionVoiceTicker owns the region; this is one of
  // the children that swap inside it.
  return <p className={`whitespace-pre-wrap text-body text-ink ${clamp ? "line-clamp-2" : ""}`}>{entry.content}</p>;
}

/** What she drew. Its own scroll, because a table that pushes the input bar off
 *  the screen defeats the mode: the header window is a fixed pane, so the
 *  overflow belongs INSIDE it and never to the page. */
export function VoiceBlocks({
  entry,
  labels,
  maxHeight = "16rem",
}: {
  entry: VoiceEntry;
  labels: ChatBlockLabels;
  maxHeight?: string;
}) {
  // Re-coerced at the point of DRAWING: a stored turn is untrusted input however
  // it was typed on the way in, and what does not survive is counted rather than
  // dropped in silence (see VoiceMetaChips, which adds it to the server's count).
  const { blocks } = renderableBlocks(entry.meta);
  if (blocks.length === 0) return null;
  return (
    <div className="mt-2 overflow-y-auto overflow-x-auto" style={{ maxHeight }}>
      <ChatBlocks blocks={blocks} labels={labels} />
    </div>
  );
}

/** What she offered. NEVER behind a disclosure in any direction: a proposal is
 *  the only part of an answer the operator has to answer, and hiding it behind
 *  "show details" would make the one actionable thing the one invisible thing. */
export function VoiceProposals({
  entry,
  proposalById,
  onResolve,
  proposalError,
}: {
  entry: VoiceEntry;
  proposalById: Map<string, CompanionProposal>;
  onResolve: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  /** The answer that did not land, and which card it belonged to. It belongs
   *  BESIDE that card and not in the strip's error line: the operator pressed a
   *  button on one row, and a sentence about it three lines up is a sentence
   *  about nothing. The dock has had this since the card gained the prop; voice
   *  mode rendered the same card without it, so a throttled Accept re-armed the
   *  buttons and said nothing at all. */
  proposalError?: { id: string; code: string } | null;
}) {
  // Ids the turn CLAIMS, resolved against the live rows — an id that no longer
  // resolves draws nothing rather than an empty card.
  const proposals = (entry.meta?.proposalIds ?? [])
    .map((id) => proposalById.get(id))
    .filter((p): p is CompanionProposal => p !== undefined);
  if (proposals.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {proposals.map((proposal) => (
        <CompanionProposalCard
          key={proposal.id}
          proposal={proposal}
          onResolve={onResolve}
          error={proposalError?.id === proposal.id ? proposalError.code : null}
        />
      ))}
    </div>
  );
}

/** What she stood on, and what did not survive. Same quiet register as the
 *  dock's marginalia — a degraded answer says so, a dropped block is admitted. */
export function VoiceMetaChips({ entry, recallLimit = 1 }: { entry: VoiceEntry; recallLimit?: number }) {
  const t = useTranslations("companion");
  const meta = entry.meta;
  // The server's count PLUS whatever died in TS coercion — the one place a
  // dropped block was still invisible.
  const dropped = renderableBlocks(meta).blockErrors;
  const droppedActions = meta?.actionErrors ?? 0;
  const degraded = meta?.source === "deterministic";
  const recall = (meta?.recallUsed ?? []).filter((hit) => (hit.insight ?? "").trim().length > 0);
  if (!degraded && dropped === 0 && droppedActions === 0 && recall.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {degraded ? <span className={`${CHIP_QUIET} text-coral`}>{t("meta.degraded")}</span> : null}
      {dropped > 0 ? <span className={CHIP_QUIET}>{t("blocks.dropped", { count: dropped })}</span> : null}
      {droppedActions > 0 ? (
        <span className={CHIP_QUIET}>{t("proposal.dropped", { count: droppedActions })}</span>
      ) : null}
      {recall.slice(0, recallLimit).map((hit) => (
        <span key={hit.path} className={CHIP_QUIET}>
          {t("meta.remembered")} {hit.insight}
        </span>
      ))}
    </div>
  );
}

/** Nothing said yet. Not a spinner and not an apology — an instruction, because
 *  the one thing an empty voice mode needs to convey is that the bar at the
 *  bottom of the screen is where you start. */
export function VoiceEmpty() {
  const t = useTranslations("companion");
  return <p className="text-sm text-steel">{t("voiceMode.empty")}</p>;
}

/** A turn is in flight. A line of text rather than a spinner, matching the
 *  dock's thinking bubble: the wait is 2-10s and honest words beat motion. */
export function VoiceBusyNote() {
  const t = useTranslations("companion");
  // NOT `role="status"`: this renders INSIDE the ticker's permanent live region,
  // and a live region nested in a live region is announced twice by some readers
  // and split by others. The wrapper announces the swap.
  return <span className="text-sm text-steel">{t("chat.thinking")}</span>;
}
