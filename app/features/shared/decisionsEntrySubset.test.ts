// The Decisions entry is a COMPILE-TIME subset of the board entry, and the one
// archetype fill has one home.
//
// Both were hand-maintained copies until now: `decisionsTypes.Entry` re-declared
// fifteen of `pipelineTypes.Entry`'s twenty-six fields with nothing checking the
// two agreed, and the archetype style table existed byte-identically in
// `decisionsTypes.ts` and `hiring/schedule/ScheduleTypes.ts`. A renamed or
// retyped board field would have silently produced two types describing the same
// `/api/pipeline` row differently — the compiler cannot see a divergence between
// two independent declarations, only between a type and a `Pick<>` of it.
//
// Most of this file is therefore TYPE-level: the assertions below fail in `tsc`
// (npm run typecheck), not at runtime. The runtime tests exist so the node:test
// runner reports the file, and so the tone tables are compared as VALUES.
//
// The two Entry types are imported TYPE-ONLY (erased): the subset assertions need
// nothing at runtime.
import test from "node:test";
import assert from "node:assert/strict";
import type { Entry as DecisionsEntry } from "./decisionsTypes.ts";
import type { Entry as PipelineEntry } from "./pipelineTypes.ts";
import { archetypeTone, ARCHETYPE_TONE } from "./archetypeTone.ts";
import { ARCHETYPE_STYLE, styleFor as pipelineStyleFor } from "./pipelineTypes.ts";
import { styleFor as decisionsStyleFor } from "./decisionsTypes.ts";
import { styleFor as scheduleStyleFor } from "@/app/features/hiring/schedule/ScheduleTypes.ts";

// ---- the subset, checked by the compiler ------------------------------------

/** `A extends B`, as a literal type. */
type Extends<A, B> = A extends B ? true : false;

/** The subset, as a tuple the COMPILER has to agree with: each slot's type is a
 *  computed `true`/`false`, and the value below states what it must be. Writing
 *  `true` where the type resolved to `false` is a tsc error (npm run typecheck),
 *  so the real assertion happens at compile time and the runtime check below is
 *  only there to make the file a test the runner reports. */
type SubsetWitness = [
  // Every Decisions field is a board field with the SAME type — the whole point
  // of the `Pick<>`. Cannot hold if a name or a type diverges.
  boardEntryFitsTheQueueEntry: Extends<PipelineEntry, DecisionsEntry>,
  // …and the subset is PROPER: the board entry carries fields Decisions does not
  // render (createdAt, notes, githubEvidence, sourceChannel…). If this flips to
  // `true` the two types have converged and one of them should go.
  queueEntryIsNotTheWholeBoardEntry: Extends<DecisionsEntry, PipelineEntry>,
  // The fields the queue actually reads, named once, so a `Pick<>` trimmed too
  // far is a tsc error here instead of a runtime `undefined` on a card.
  queueKeepsWhatItRenders: Extends<
    DecisionsEntry,
    {
      id: string;
      candidateId: string | null;
      candidateLabel: string;
      archetype: string | null;
      stage: string;
      status: string;
      approvalKind: string | null;
      approvalDetail: string | null;
    }
  >,
];

const SUBSET: SubsetWitness = [true, false, true];

test("the subset witness holds (the assertion itself is in tsc)", () => {
  assert.deepEqual(SUBSET, [true, false, true]);
});

test("the decisions Entry is assignable from a board entry (runtime witness)", () => {
  const board = {
    id: "e1",
    candidateId: "c1",
    candidateLabel: "A. Novak",
    archetype: "student",
    roleFamily: "software_engineering",
    jobId: "j1",
    jobTitle: "Backend engineer",
    stage: "Screened",
    matchScore: 71,
    status: "open",
    approvalKind: null,
    approvalDetail: null,
    createdAt: null,
    stageChangedAt: null,
  } satisfies PipelineEntry;
  const queue: DecisionsEntry = board;
  assert.equal(queue.candidateLabel, "A. Novak");
  assert.equal(queue.stage, "Screened");
});

// ---- one archetype fill -----------------------------------------------------

test("decisions and schedule resolve the archetype fill through the SAME function", () => {
  assert.equal(decisionsStyleFor, scheduleStyleFor, "both are re-exports of archetypeTone");
  assert.equal(decisionsStyleFor, archetypeTone);
});

test("the tone table agrees with the board's full presentation catalog", () => {
  // pipelineTypes.ARCHETYPE_STYLE is the RICH catalog (label + fill + ring +
  // glyph) the board rows need; this is the fill-only one. They must not drift.
  for (const key of Object.keys(ARCHETYPE_TONE)) {
    assert.equal(ARCHETYPE_TONE[key].bg, ARCHETYPE_STYLE[key].bg, `${key} fill`);
  }
  assert.deepEqual(Object.keys(ARCHETYPE_TONE).sort(), Object.keys(ARCHETYPE_STYLE).sort());
});

test("an unknown or null archetype falls back to the bau fill, never undefined", () => {
  // FALLBACK_ARCHETYPE is "unknown" — deliberately outside the taxonomy — and a
  // row for it must still paint rather than render `bg-undefined`.
  assert.equal(archetypeTone(null).bg, "bg-steel");
  assert.equal(archetypeTone("unknown").bg, "bg-steel");
  assert.equal(archetypeTone("career_switcher").bg, "bg-moss");
  assert.equal(archetypeTone("student").bg, pipelineStyleFor("student").bg);
});

// The dead field, pinned gone: a raw English `label` inside a style table is a
// translation leak waiting to happen (the visible text comes from
// `enumLabel("archetype", …)` at every call site).
test("the shared tone carries NO label field", () => {
  assert.deepEqual(Object.keys(archetypeTone("student")), ["bg"]);
});
