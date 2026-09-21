// Which half of the Job-intake tab a URL is asking for — pure, so the rule is
// pinned by a test rather than re-read from the component.
//
// The tab defaults to the intake DIALOG. Three kinds of link mean the opposite,
// and all three are a JD the recruiter already has in hand:
//   ?duplicate=<slug>  a saved role being regenerated from its original prompt
//   ?jdTask=<id>       a finished background build being rehydrated (TasksOutcome)
//   ?jdTitle= / ?jdNeed= / ?jdCompany= / ?jdSeniority= / ?jdFamily=
//                      a prefilled builder someone linked to from outside
// …and so does a fourth door that is NOT a link at all: an in-app handoff
// (`BuilderHandoff` below), which is how the guided demo's design chapter passes
// its simulated role now that it no longer spells that role out in the address
// bar. Getting the answer wrong is not cosmetic either way: a handoff that lands
// on the dialog drops what it was carrying, because the builder reads its seeds
// at mount only.

/** The Duplicate handoff's slug param (tab-scoped, one-shot — see tabs.ts). */
export const DUPLICATE_PARAM = "duplicate";

const BUILDER_PARAMS = [DUPLICATE_PARAM, "jdTask", "jdTitle", "jdNeed", "jdCompany", "jdSeniority", "jdFamily"] as const;

/** Minimal read shape — URLSearchParams and next/navigation's ReadonlyURLSearchParams both satisfy it. */
type ParamReader = { get(name: string): string | null };

/** A JD handed to the builder in APP STATE rather than in the URL. The guided
 *  demo is the one producer today (`SimState.jdHandoff`); the shape is structural
 *  on purpose, so this module stays pure and free of a simulation import. */
export type BuilderHandoff = { title?: string; need?: string } | null | undefined;

/** Is a handoff carrying anything? An object whose seeds are all empty is not a
 *  handoff — the same rule an empty `?jdTitle=` gets below. */
export function hasBuilderHandoff(handoff: BuilderHandoff): boolean {
  return Boolean(handoff && ((handoff.title ?? "") !== "" || (handoff.need ?? "") !== ""));
}

/** Does this mount ask for the builder rather than the intake dialog? Answered
 *  from BOTH doors: the URL (an external deep link) and an in-app handoff. */
export function opensOnGenerate(params: ParamReader, handoff?: BuilderHandoff): boolean {
  if (hasBuilderHandoff(handoff)) return true;
  return BUILDER_PARAMS.some((key) => {
    const value = params.get(key);
    return typeof value === "string" && value.length > 0;
  });
}

/** The "start a conversation" handoff: `?intake=new`. The command palette emits
 *  it, and so can any surface that wants to hand a hiring need straight to the
 *  studio rather than to a ledger the reader then has to act on again. */
export const NEW_INTAKE_PARAM = "intake";
const NEW_INTAKE_VALUE = "new";

/**
 * Does this URL ask for a fresh intake session?
 *
 * Deliberately exact — only the literal `new`, not "any non-empty value". The
 * param names an ACTION with a side effect (it creates a `role_intakes` row and
 * spawns the opener), so a future `?intake=<id>` meaning "open this one" must not
 * be read as "make another"; an unrecognised value lands on the ledger, which is
 * the harmless answer.
 *
 * A builder handoff wins: `opensOnGenerate` decides the tab's mode at mount, and
 * a URL carrying both would otherwise open a conversation on top of a prefilled
 * builder the reader can no longer see. That holds for the in-app handoff too —
 * hence the same second argument.
 */
export function opensNewIntake(params: ParamReader, handoff?: BuilderHandoff): boolean {
  return params.get(NEW_INTAKE_PARAM) === NEW_INTAKE_VALUE && !opensOnGenerate(params, handoff);
}
