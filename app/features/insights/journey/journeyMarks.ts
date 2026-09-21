// The provenance vocabulary of a journey row — the part the reader must be able
// to decode from the MARK alone, without consulting the legend.
//
// The contest's winning prototype ("The Broadsheet") carried four independent
// honesty axes on every row and drew each one typographically rather than in a
// colour key: who acted, whether the row is a real product row, whether it was
// attached to this candidate by name alone, and whether kp knows the actor at
// all. This module is that vocabulary as data, so the class strings live in one
// place and the same decision is available to the aria text, the minimap and the
// fact card.
//
// PURE + JSX-FREE on purpose: `node --test` strips types but cannot parse JSX,
// and this is the module every cell in a 99-column board depends on.

import type { JourneyEvent, JourneyOrigin } from "@/app/_lib/journey/types";

/**
 * Who acted. `unidentified` is a FACT, not an absence — `actor: null` means kp
 * genuinely does not know, and types.ts calls that out as the one deliberate
 * `| null` in the whole contract. It gets its own mark rather than a blank.
 */
export type ActorKind = "human" | "machine" | "unidentified";

export function actorKind(actor: string | null | undefined): ActorKind {
  if (actor == null) return "unidentified";
  if (actor.startsWith("human:")) return "human";
  if (actor.startsWith("auto:")) return "machine";
  // A writer that put something else in the column is not "unknown actor" — it
  // named someone kp cannot classify. Reading it as human would overstate; the
  // honest read is the same as an unprefixed legacy value: not identified.
  return "unidentified";
}

/** The catalog key for an actor kind, relative to the `journey` namespace.
 *  Spelled out as literals rather than built with a template string so the key
 *  stays a next-intl LITERAL — a `t(`mark.${x}`)` is only as typed as the union
 *  TypeScript can prove, and a grep for `mark.unidentified` finds this line. */
export const ACTOR_MARK_KEY: Record<ActorKind, "mark.human" | "mark.machine" | "mark.unidentified"> = {
  human: "mark.human",
  machine: "mark.machine",
  unidentified: "mark.unidentified",
};

/**
 * OBSERVED — "a real product row" (`journey.mark.observed`).
 *
 * The prototypes had a `synthetic` array because their corpus was padded for the
 * contest. The real contract has no such field, and inventing one would be the
 * exact dishonesty this feature exists to remove. The two things the real
 * payload DOES say about whether a row can be trusted as a real, correctly
 * attributed product row are:
 *
 *   1. `column.origin` — a `/uat` L2 run drives the real app against a real
 *      database, so it produces genuine columns that must never be counted as
 *      live traffic (types.ts, JourneyOrigin).
 *   2. `event.confidence === "label-only"` — the row was joined to this
 *      candidate by a name match with no confirming job axis and may belong to
 *      somebody else.
 *
 * A row is observed when neither applies. That is what "Observed rows only"
 * filters to, and it is a strictly stronger claim than "not from a test run",
 * which is what the separate `journey.filters.testRuns` control answers.
 */
export function isObservedRow(
  event: Pick<JourneyEvent, "confidence">,
  origin: JourneyOrigin | undefined
): boolean {
  if (event.confidence === "label-only") return false;
  return origin === undefined || origin.kind === "live";
}

export type RowProvenance = {
  actor: ActorKind;
  /** See isObservedRow. False = draw it as generated: italic, dotted rule. */
  observed: boolean;
  /** Matched by name alone — `≈` plus a wavy underline, never presented as certain. */
  labelOnly: boolean;
  /** The column this row hangs under came from a test run, not live traffic. */
  fromTestRun: boolean;
};

export function rowProvenance(
  event: Pick<JourneyEvent, "actor" | "confidence">,
  origin: JourneyOrigin | undefined
): RowProvenance {
  return {
    actor: actorKind(event.actor),
    observed: isObservedRow(event, origin),
    labelOnly: event.confidence === "label-only",
    fromTestRun: origin !== undefined && origin.kind === "test-run",
  };
}

/* ── The marks themselves ──────────────────────────────────────────────────
 *
 * Every colour resolves through a brand token so it follows [data-theme="dark"]:
 * coral for a human, steel for the machine, dial-stone for "not identified",
 * amber for every uncertainty caveat. No raw hex, no inline rgba — the hatch
 * patterns below spell their stripe as `var(--color-*)` exactly the way
 * `app/features/insights/matrix/matrixCellClass.ts:38` does.
 */

/** The 8px glyph at the head of a row. Shape AND fill differ per actor, so the
 *  mark survives a monochrome print and a colour-vision difference. */
export const ACTOR_GLYPH: Record<ActorKind, string> = {
  // filled disc
  human: "h-2 w-2 shrink-0 rounded-full bg-coral",
  // filled square
  machine: "h-2 w-2 shrink-0 bg-steel",
  // hollow dashed diamond — the shape types.ts asks for when kp does not know
  unidentified: "h-2 w-2 shrink-0 rotate-45 border border-dashed border-dial-stone",
};

/** The left rule of a row: solid when observed, dotted when generated. */
export const ACTOR_RULE: Record<ActorKind, string> = {
  human: "border-l-coral",
  machine: "border-l-steel",
  unidentified: "border-l-dial-stone",
};

/** Faint diagonal hatch behind a generated row. Token-resolved stripe. */
export const GENERATED_HATCH =
  "[background-image:repeating-linear-gradient(135deg,var(--color-stone-200)_0px,var(--color-stone-200)_1px,transparent_1px,transparent_6px)]";

/** "Nothing happened here, and here is why" — a solid, calm stone hatch. */
export const VOID_HATCH =
  "bg-stone-100 [background-image:repeating-linear-gradient(45deg,var(--color-stone-300)_0px,var(--color-stone-300)_1px,transparent_1px,transparent_5px)]";

/** "Never recorded" — amber, dotted, deliberately unlike the calm stone hatch. */
export const NEVER_RECORDED_FILL =
  "bg-amber-50 [background-image:repeating-linear-gradient(0deg,var(--color-amber-300)_0px,var(--color-amber-300)_1px,transparent_1px,transparent_7px)]";

/** "Never reached — the journey ends here": one block to the foot of the band. */
export const NEVER_REACHED_FILL =
  "bg-stone-50 [background-image:repeating-linear-gradient(90deg,var(--color-stone-300)_0px,var(--color-stone-300)_2px,transparent_2px,transparent_8px)]";

/**
 * The full class string for one row's text treatment. Composed rather than
 * conditioned at the call site so a cell, a shared-band row and the fact card's
 * headline all say the same thing the same way.
 */
export function rowTextClass(p: RowProvenance): string {
  const parts = ["block", "text-sm", "leading-snug", "break-words"];
  if (!p.observed) parts.push("italic");
  if (p.labelOnly) parts.push("underline", "decoration-wavy", "decoration-amber-600", "underline-offset-4");
  if (p.actor === "unidentified") parts.push("text-steel");
  else parts.push("text-ink");
  return parts.join(" ");
}

/** The class string for the row's container (the left rule + generated hatch). */
export function rowFrameClass(p: RowProvenance): string {
  const parts = ["border-l-2", ACTOR_RULE[p.actor]];
  // `border-solid` / `border-dotted` set the style on every edge; only the left
  // edge has a width, so this is the left rule's style and nothing else.
  parts.push(p.observed ? "border-solid" : "border-dotted");
  if (!p.observed) parts.push(GENERATED_HATCH);
  return parts.join(" ");
}
