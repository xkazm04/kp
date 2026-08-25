import type { ReactNode } from "react";
import type { ChatBlockLabels } from "@/app/_components/chat/chatBlockTypes";
import type { CompanionProposal } from "@/app/_lib/db/companion";
import type { AttentionCounts } from "@/app/features/shell/useAttention";
import type { CompanionSpeech } from "../useCompanionSpeech";
import type { VoiceHistory } from "./useVoiceHistory";

/*
 * The contract every voice-mode direction renders against (prototype round V2).
 *
 * IDENTICAL props for all three, on purpose: the host owns the thread, the
 * speech seam, the reading position and the window's fixed geometry, and a
 * variant owns nothing but its metaphor. That is what makes the switcher
 * throwaway — deleting the two losers is deleting two files and two lines, with
 * no state to unpick — and what makes the winner promotable without a rewrite.
 */
export type VoiceVariantProps = {
  /** Where in her answers the operator is, and how to move. */
  history: VoiceHistory;
  speech: CompanionSpeech;
  /** A turn is in flight. The shown answer is still the last one she gave —
   *  a fetch never blanks what is already on screen. */
  busy: boolean;
  /** Already resolved to a sentence by the host; null when nothing failed. */
  error: string | null;
  /** Live proposal rows, keyed by id — the turn's `meta.proposalIds` is what
   *  joins them, never position. */
  proposalById: Map<string, CompanionProposal>;
  onResolveProposal: (id: string, decision: "accept" | "decline") => Promise<boolean>;
  blockLabels: ChatBlockLabels;
  /** The same counts behind the sidebar badges. Only the information-dense
   *  direction draws them; the others are handed them and decline. */
  attention: AttentionCounts | null;
  /** The window's own controls (settings, close) and the round's direction
   *  switcher. A slot rather than a fixed row, so each direction can place the
   *  chrome where its metaphor puts it — a full-width rail for the strips, and
   *  inside the card for the centred one. */
  chrome: ReactNode;
};
