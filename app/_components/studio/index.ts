// Studio kit — the domain-agnostic three-zone dialog desk (transcript · composer ·
// plane) that the recruiter Intake Studio and the job-seeker CV / fit dialogs share.
//
// WP0 pre-seed: this file fixes the PUBLIC SURFACE (names + prop types) so the two
// consumers can be built in parallel against it. WP1 replaces the throwing stubs
// with the components extracted from app/features/library/jds/intake/coats/atelier/*
// without changing a single prop name declared here. The rule from the design waves:
// variants are PROPS (plane, api, i18n namespace, storage key) — never coats, never
// a `variant` switch inside a component.
//
// Nothing in this directory may import from app/features/** — the kit is a primitive.

import type { ReactNode } from "react";
import type { StudioChoiceSet, StudioReply, StudioTurn } from "@/app/_lib/jobseeker/types";

export type { StudioChoiceSet, StudioReply, StudioTurn };

/** The endpoint adapter a consumer hands the desk: one method, one abortable turn. */
export type StudioApi = {
  send(text: string, signal?: AbortSignal): Promise<StudioReply>;
};

/** The zone vocabulary is per consumer (intake: draft|chat|brief|materials; seeker:
 *  chat|sheet). Toggle state is stored under the consumer's `storageKey`, SSR-guarded. */
export type StudioZones<K extends string> = {
  keys: readonly K[];
  storageKey: string;
  /** Zones that cannot be hidden (the transcript, always). */
  pinned: readonly K[];
};

export type StudioOverlayProps = {
  open: boolean;
  onClose(): void;
  /** While a turn is in flight Escape asks for confirmation instead of closing. */
  sending: boolean;
  /** next-intl namespace the kit reads its own chrome strings from
   *  (`<ns>.studio.*`); intake passes "library.tab.intake", the seeker passes "me". */
  ns: string;
  titleId: string;
  children: ReactNode;
};

export type StudioTranscriptProps = {
  turns: StudioTurn[];
  /** Turn index of the latest reply, for the arrival animation and read-aloud. */
  latestIndex: number | null;
  /** A choice-card pick sends an ordinary message; "none of these" hands focus back. */
  onPick(message: string): void;
  onDecline(): void;
  sending: boolean;
  ns: string;
  /** Read-aloud button per interviewer turn (null hides it). */
  onSpeak?: ((text: string, turnIndex: number) => void) | null;
  speakingIndex?: number | null;
};

export type StudioComposerProps = {
  onSend(text: string): Promise<boolean> | boolean;
  disabled: boolean;
  sending: boolean;
  /** sessionStorage key for the unsent draft (hand-back on a refused send). */
  draftKey: string;
  ns: string;
  /** The dictation control slot (StudioVoiceBar) — a ReactNode so the kit never
   *  hardcodes which voice plane a consumer wires. */
  voiceSlot?: ReactNode;
  placeholder?: string;
  maxChars?: number;
};

export type StudioChoiceCardsProps = {
  set: StudioChoiceSet;
  onPick(message: string): void;
  onDecline(): void;
  disabled: boolean;
  ns: string;
};

export type StudioVoiceBarProps = {
  /** Appends dictated text to the composer draft; never sends. */
  onDictation(text: string): void;
  disabled: boolean;
  ns: string;
  /** localStorage key for the auto-speak preference (per consumer). */
  autoSpeakStorageKey: string;
  lang: string;
};

export type StudioDeskProps<K extends string> = {
  zones: StudioZones<K>;
  /** The right-hand plane (a hiring brief, a CV sheet, a posting sheet). */
  plane: ReactNode;
  planeZone: K;
  transcript: ReactNode;
  composer: ReactNode;
  /** Optional extra zones keyed by zone id (intake: draft, materials). */
  extra?: Partial<Record<K, ReactNode>>;
  ns: string;
};

function notBuiltYet(name: string, ...received: unknown[]): never {
  throw new Error(`studio kit: ${name} is a WP0 stub (${received.length} arg(s)); WP1 extracts it from the intake atelier`);
}

export function StudioOverlay(_props: StudioOverlayProps): ReactNode {
  return notBuiltYet("StudioOverlay", _props);
}
export function StudioTranscript(_props: StudioTranscriptProps): ReactNode {
  return notBuiltYet("StudioTranscript", _props);
}
export function StudioComposer(_props: StudioComposerProps): ReactNode {
  return notBuiltYet("StudioComposer", _props);
}
export function StudioChoiceCards(_props: StudioChoiceCardsProps): ReactNode {
  return notBuiltYet("StudioChoiceCards", _props);
}
export function StudioVoiceBar(_props: StudioVoiceBarProps): ReactNode {
  return notBuiltYet("StudioVoiceBar", _props);
}
export function StudioDesk<K extends string>(_props: StudioDeskProps<K>): ReactNode {
  return notBuiltYet("StudioDesk", _props);
}

/** Build the message a choice pick sends — the one place the card→message shape
 *  lives (today `choiceMessage` in intake; WP1 moves it here). */
export function choiceMessage(_set: StudioChoiceSet, _ids: string[]): string {
  return notBuiltYet("choiceMessage", _set, _ids);
}
