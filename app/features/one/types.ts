// /one — the wire vocabulary every layout direction codes against (docs/design/one-interface.md).
//
// Closed vocabularies in the repo's shape (app/features/shell/tabs.ts): ONE literal array,
// the union derived from it, and a runtime guard built from the same array — so the type,
// the guard and the validation door (engine/validate.ts) can never disagree about what a
// panel, an act or a chip is.
//
// Governing standard: registry subject `model-composed-workspace` (composition-region,
// reversible-screen-ops). The model composes ONLY into the region, through these verbs;
// it never writes a figure (panels fetch their own numbers), and anything that would
// change data is a `propose`, armed only through the ConsentCard.
//
// Import-free at runtime (the WorkspaceTabId import is type-only), so node:test reads it
// directly and no layout pulls the shell's graph by importing the contract.
import type { WorkspaceTabId } from "@/app/features/shell/tabs";

/** The module views the conductor may place in the region. One component + one data
 *  hook each (panels/); each owns its loading, empty and error states. */
export const PANEL_KINDS = [
  "needs",
  "pipelineSlice",
  "scheduleAhead",
  "funnel",
  "jobDrafts",
  "outbox",
  "decisionsQueue",
  "roleCard",
] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
export const isPanelKind = (v: unknown): v is PanelKind => (PANEL_KINDS as readonly unknown[]).includes(v);

/** The data-changing acts. Never executed by being applied — a `propose` op renders a
 *  ConsentCard, and only the user's press reaches the existing door (consent/acts.ts). */
export const ACT_KINDS = ["entryAdvance", "entryReject", "wave", "companion"] as const;
export type ActKind = (typeof ACT_KINDS)[number];
export const isActKind = (v: unknown): v is ActKind => (ACT_KINDS as readonly unknown[]).includes(v);

/** The follow-up questions offered under a reply. A chip is an intent with a fixed
 *  meaning, so pressing one never goes through the keyword matcher. */
export const CHIP_IDS = [
  "needs",
  "decisions",
  "pipeline",
  "stalled",
  "interviews",
  "funnel",
  "arrivals",
  "drafts",
  "outbox",
  "digest",
] as const;
export type ChipId = (typeof CHIP_IDS)[number];
export const isChipId = (v: unknown): v is ChipId => (CHIP_IDS as readonly unknown[]).includes(v);

/** The layout directions under judgement. `greet` is the round-1 baseline (kept); `split`,
 *  `spotlight` and `ticker` are the round-2 refinements — they differ only in WHERE the
 *  current answer lands. */
export const VARIANT_IDS = ["greet", "split", "spotlight", "ticker"] as const;
export type VariantId = (typeof VARIANT_IDS)[number];
export const isVariantId = (v: unknown): v is VariantId => (VARIANT_IDS as readonly unknown[]).includes(v);
/** `?v=` absent or unknown → split (the round-2 lead). */
export function variantOf(raw: unknown): VariantId {
  return isVariantId(raw) ? raw : "split";
}

/** The closed set of screen operations. `navigate` is a Console deep link: the region
 *  offers it as a link on the turn, it never yanks the user off /one by itself. */
export type Op =
  | { op: "show"; panel: PanelKind; params?: Record<string, string> }
  | { op: "focus"; panelId: string }
  | { op: "propose"; act: ActKind; params: Record<string, string> }
  | { op: "navigate"; tab: WorkspaceTabId; params?: Record<string, string> };

/** What the conductor says. Every key lives under `one.core.say.*` and the UI translates
 *  it, so the catalogs stay the authority. `values` never carry a figure (validate.ts
 *  refuses one): numbers come from panels, never from the reply. */
export const SAY_KEYS = [
  "empty",
  "needsShown",
  "decisionsShown",
  "pipelineShown",
  "pipelineRoleShown",
  "stalledShown",
  "interviewsShown",
  "funnelShown",
  "arrivalsShown",
  "draftsShown",
  "outboxShown",
  "roleShown",
  "roleAsk",
  "waveRejectProposed",
  "waveAdvanceProposed",
  "companionProposed",
  "consoleOffered",
  "notYet",
] as const;
export type SayKey = (typeof SAY_KEYS)[number];
export const isSayKey = (v: unknown): v is SayKey => (SAY_KEYS as readonly unknown[]).includes(v);
export type Say = { key: SayKey; values?: Record<string, string> };

/** One reply. ≤ 4 ops, ≤ 4 chips (validate.ts). `fallback` = the honest "not in this
 *  prototype yet" answer — a variant may draw it differently, never hide it. */
export type Reply = { say: Say; ops: Op[]; chips: ChipId[]; fallback?: boolean };

export const MAX_OPS = 4;
export const MAX_CHIPS = 4;
/** The region holds at most three views; a fourth replaces the oldest unpinned one. */
export const MAX_PANELS = 3;
/** At most two pinned views, so a fourth `show` always has something it may replace. */
export const MAX_PINS = 2;

/** A view on screen. `id` is the host's, never the model's. */
export type PanelInstance = {
  id: string;
  kind: PanelKind;
  params: Record<string, string>;
  pinned: boolean;
};

/** An act waiting on the user's consent. `origin` says who put it there: the conductor's
 *  reply or the user's own press on a panel row. */
export type ProposalInstance = {
  id: string;
  act: ActKind;
  params: Record<string, string>;
  origin: "reply" | "hand";
  turnId: string | null;
};

/** The one-line "what changed". `panel` / `previous` are kinds the UI names in words. */
export const CHANGE_KEYS = [
  "shown",
  "replaced",
  "focused",
  "closed",
  "pinned",
  "unpinned",
  "undone",
  "dropped",
  "stopped",
  "pinLimit",
  "stepped",
] as const;
export type ChangeKey = (typeof CHANGE_KEYS)[number];
export type ChangeLine = {
  key: ChangeKey;
  panel?: PanelKind;
  previous?: PanelKind;
  /** The user's hand landed while a reply's change was pending; that change was dropped. */
  droppedPending?: boolean;
  /** `stepped`: which answer is in view, 1-based, of how many ("Showing answer 2 of 5"). */
  answer?: number;
  of?: number;
};

/** One exchange in the conversation. `input` is the user's own words (or chip), kept
 *  verbatim — the user's words may hold digits, the conductor's may not. */
export type Turn =
  | { id: string; who: "user"; text: string | null; chip: ChipId | null }
  | {
      id: string;
      who: "one";
      say: Say;
      chips: ChipId[];
      fallback: boolean;
      /** Console deep links the reply offered (`navigate` ops). */
      links: { tab: WorkspaceTabId; params: Record<string, string> }[];
      /** Ops the validation door refused, counted and disclosed. */
      dropped: number;
    };

/** What the composer submits. */
export type OneInput = { chip?: ChipId; text?: string };
