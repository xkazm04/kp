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
  /** The answer in view (same as session.current): asked, reply, panels, proposals. */
  current: OneSession["current"];
  /** Which answer is in view: 0-based `index` of `total`, plus whether a step exists. */
  position: OneSession["position"];
  /** Walk the answers. Navigation, not undo; ignored while a reply is pending. */
  stepBack: () => void;
  stepForward: () => void;
  /** Render one view with its data, states and the host's pin/close/focus chrome.
   *  `look`: "table" fills its container (give it a height), "insight" is the answer's card
   *  (the shape of the answer + at most one suggested act; it grows into the height it is
   *  given; `onExpand` adds a See-all), "list" is a dense single column for a narrow side. */
  renderPanel: (panel: PanelInstance, opts?: { look?: PanelLook; className?: string; onExpand?: () => void }) => ReactNode;
  /** Render the consent card for one proposed act. */
  renderConsent: (proposal: ProposalInstance, opts?: { className?: string }) => ReactNode;
  /** Every user-facing word of the core (say keys, chips, view names, change line). */
  words: OneWords;
  /** The Console (today's Workspace) — also reached with Ctrl/⌘ K. */
  consoleHref: string;
};
