"use client";

import { useTranslations } from "next-intl";
import { ChatBlocks } from "@/app/_components/chat/ChatBlocks";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import type { CompanionProposal } from "@/app/_lib/db/companion";
import { CompanionProposalCard } from "../CompanionProposalCard";
import type { VoiceEntry } from "./voiceHistory";

/*
 * The pieces one answer is made of, shared by all three directions.
 *
 * They were extracted the moment the second variant needed the second one — the
 * prototype rule about hoisting mid-round rather than at refactor time. What a
 * direction actually differs in is WHERE these sit and which are behind a
 * disclosure; none of them differs in what a proposal card is or how a dropped
 * block is admitted, and three copies of that would drift within a round.
 *
 * The reading order is the dock's, unchanged: what she DREW, what she OFFERED,
 * what she STOOD ON. Voice mode compresses the geometry, not the honesty.
 */

/** Her answer as prose. `clamp` is the strips' whole trick: two lines is a
 *  glance, and the disclosure below is where the rest lives. */
export function VoiceProse({ entry, clamp = false }: { entry: VoiceEntry; clamp?: boolean }) {
  return (
    <p
      className={`whitespace-pre-wrap text-body text-ink ${clamp ? "line-clamp-2" : ""}`}
      // Announced as one region when the arrows or a new reply change it — the
      // window IS the reading surface here, unlike the dock where the transcript
      // owns the live region.
      aria-live="polite"
    >
      {entry.content}
    </p>
  );
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
  const blocks = entry.meta?.blocks ?? [];
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
}: {
  entry: VoiceEntry;
  proposalById: Map<string, CompanionProposal>;
  onResolve: (id: string, decision: "accept" | "decline") => Promise<boolean>;
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
        <CompanionProposalCard key={proposal.id} proposal={proposal} onResolve={onResolve} />
      ))}
    </div>
  );
}

/** What she stood on, and what did not survive. Same quiet register as the
 *  dock's marginalia — a degraded answer says so, a dropped block is admitted. */
export function VoiceMetaChips({ entry, recallLimit = 1 }: { entry: VoiceEntry; recallLimit?: number }) {
  const t = useTranslations("companion");
  const meta = entry.meta;
  const dropped = meta?.blockErrors ?? 0;
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

/** The question this answer answered, echoed small. Voice mode shows ONE reply
 *  with no transcript above it, so without this an operator arriving after a
 *  minute away has her answer and no idea what it was to. */
export function VoicePromptEcho({ entry, className = "" }: { entry: VoiceEntry; className?: string }) {
  const t = useTranslations("companion");
  if (!entry.prompt) return null;
  return (
    <p className={`truncate text-sm text-steel ${className}`}>
      <span className={CHIP_QUIET}>{t("voiceMode.prompt")}</span> {entry.prompt}
    </p>
  );
}

/** Nothing said yet. Not a spinner and not an apology — an instruction, because
 *  the one thing an empty voice mode needs to convey is that the bar at the
 *  bottom of the screen is where you start. */
export function VoiceEmpty({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("companion");
  return <p className={`text-steel ${compact ? "text-sm" : "text-body"}`}>{t("voiceMode.empty")}</p>;
}

/** A turn is in flight. A line of text rather than a spinner, matching the
 *  dock's thinking bubble: the wait is 2-10s and honest words beat motion. */
export function VoiceBusyNote({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("companion");
  return (
    <span className={`${compact ? "text-sm" : "text-body"} text-steel`} role="status">
      {t("chat.thinking")}
    </span>
  );
}
