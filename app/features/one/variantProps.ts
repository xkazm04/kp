// What every /one layout direction receives — the whole shared core, so a variant
// builder writes LAYOUT only (app/features/one/variants/<id>/) and never re-implements
// data, the conductor, the session rules or the consent wiring.
import type { ReactNode } from "react";
import type { AttentionCounts } from "@/app/_lib/attention";
import type { Greeting } from "./engine/greeting";
import type { PanelLook } from "./panels/types";
import type { OneInput, PanelInstance, ProposalInstance, VariantId } from "./types";
import type { OneSession } from "./useOneSession";
import type { OneWords } from "./words";

export type GreetingState = { state: "loading" } | Greeting;

export type VariantProps = {
  variant: VariantId;
  /** Turns, panels on screen, pins, proposals, lastChange, pending — plus the hand
   *  actions (show / focus / close / pin / unpin / undo / stop / propose / dismiss). */
  session: OneSession;
  /** Ask the conductor. Same as session.submit; here for the common case. */
  submit: (input: OneInput) => void;
  /** The first beat, composed by the host from /api/attention. */
  greeting: GreetingState;
  /** The raw attention read (null until it lands or when it failed). */
  attention: AttentionCounts | null;
  /** Render one view with its data, states and the host's pin/close/focus chrome. */
  renderPanel: (panel: PanelInstance, opts?: { look?: PanelLook; className?: string }) => ReactNode;
  /** Render the consent card for one proposed act. */
  renderConsent: (proposal: ProposalInstance, opts?: { className?: string }) => ReactNode;
  /** Every user-facing word of the core (say keys, chips, view names, change line). */
  words: OneWords;
  /** The Console (today's Workspace) — also reached with Ctrl/⌘ K. */
  consoleHref: string;
};
