// The Define-need form's ONE non-trivial computation, extracted out of
// useDevTabData.ts so it can be tested.
//
// WHY IT MATTERS. Everything downstream of the Define tab is built from this
// object: the analyze step reads `jdText`, the role designer reads `stack` and
// `statedRequirements`, the case designer reads `responsibilities` and
// `codebaseRefs`. It is a pure fold of the selected JD plus two form fields —
// three merges, four caps and a conditional key — and it lived inside a React
// hook, where a repo with no jsdom cannot reach it. A silent regression here (a
// cap applied to the wrong list, the graded requirements dropped for a brief that
// has them) produces a plausible-looking assignment designed against the wrong
// need, and nothing on screen says so.
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import type { SelectedJd } from "./DevTypes";

/** How many graded must-haves become the need's `stack`. */
export const MAX_STACK = 10;
/** How many outcomes + responsibilities become the need's `responsibilities`. */
export const MAX_RESPONSIBILITIES = 12;

/** The shape the lifecycle/analyze routes receive as `need`. Deliberately
 *  `Record<string, unknown>`-compatible: the routes validate it on their side and
 *  the Python models are the contract, so re-typing it here would be a second,
 *  drifting copy of that schema. */
export type BuiltNeed = {
  title: string;
  stack: string[];
  responsibilities: string[];
  codebaseRefs: { kind: string; ref: string }[];
  seniorityTarget: string;
  roleFamily: string;
  jdSlug: string;
  jdText: string;
  statedRequirements?: { skill: string; kind: string; hardness?: unknown; weight?: unknown }[];
};

export function buildNeed(input: {
  jd: SelectedJd | null;
  repoUrls: string[];
  seniority: string;
}): BuiltNeed {
  const { jd, repoUrls, seniority } = input;
  // Promoted-intake JD → the brief's structured fields fill the need (the same fill
  // runJdBuild does for JdBuildInput.brief — closing the dual-fill asymmetry noted in
  // app/_lib/devcase-run.ts / UAT L1-EVA-3): stack from graded must-haves,
  // responsibilities from 90-day outcomes, and the graded requirements themselves ride
  // along for role design. jdText stays the prose anchor either way.
  const brief = jd?.brief ?? null;
  const musts = (brief?.requirements ?? []).filter((r) => r.kind === "must_have").map((r) => r.skill);
  // `statedRequirements` is present only when the brief actually grades something —
  // an empty array would tell the designer "this need has NO stated requirements",
  // which is a different claim from "nothing graded it".
  const graded = (brief?.requirements ?? []).filter((r) => r.skill);
  return {
    title: (jd?.title ?? "").trim(),
    stack: musts.slice(0, MAX_STACK),
    responsibilities: brief
      ? [...(brief.successCriteria ?? []), ...(brief.responsibilities ?? [])].filter(Boolean).slice(0, MAX_RESPONSIBILITIES)
      : [],
    codebaseRefs: repoUrls
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, MAX_CODEBASES)
      .map((ref) => ({ kind: "github", ref })),
    seniorityTarget: seniority,
    // roleFamily: the brief's classified family when an intake backs the JD (the
    // design/eval chain is domain-neutral since the rubric was de-industry-locked);
    // the software_engineering constant remains the recorded default for JD-only
    // needs, where nothing has classified them.
    roleFamily: brief?.roleFamily || "software_engineering",
    jdSlug: jd?.slug ?? "",
    jdText: jd?.body ?? "",
    ...(brief && graded.length
      ? {
          statedRequirements: graded.map((r) => ({
            skill: r.skill,
            kind: r.kind,
            hardness: r.hardness,
            weight: r.weight,
          })),
        }
      : {}),
  };
}
