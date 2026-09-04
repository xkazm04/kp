// Which half of the Job-intake tab a URL is asking for — pure, so the rule is
// pinned by a test rather than re-read from the component.
//
// The tab defaults to the intake DIALOG. Three kinds of link mean the opposite,
// and all three are a JD the recruiter (or the demo) already has in hand:
//   ?duplicate=<slug>  a saved role being regenerated from its original prompt
//   ?jdTask=<id>       a finished background build being rehydrated (TasksOutcome)
//   ?jdTitle= / ?jdNeed= / ?jdCompany= / ?jdSeniority= / ?jdFamily=
//                      a prefilled builder (the guided demo's design step)
// Getting this wrong is not cosmetic: a deep link that lands on the dialog drops
// the prefill it carried, because the builder reads its seeds at mount only.

/** The Duplicate handoff's slug param (tab-scoped, one-shot — see tabs.ts). */
export const DUPLICATE_PARAM = "duplicate";

const BUILDER_PARAMS = [DUPLICATE_PARAM, "jdTask", "jdTitle", "jdNeed", "jdCompany", "jdSeniority", "jdFamily"] as const;

/** Minimal read shape — URLSearchParams and next/navigation's ReadonlyURLSearchParams both satisfy it. */
type ParamReader = { get(name: string): string | null };

export function opensOnGenerate(params: ParamReader): boolean {
  return BUILDER_PARAMS.some((key) => {
    const value = params.get(key);
    return typeof value === "string" && value.length > 0;
  });
}
