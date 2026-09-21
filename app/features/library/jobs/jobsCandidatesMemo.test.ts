// The memo boundaries of the ranked-candidates column, NAMED.
//
// Why a structural test. Every derivation in this surface used to be re-computed
// on every keystroke of every unrelated state change: the eligible partition, the
// pool-fit filter, the two cohort splits, the not-eligible list, the fairness
// re-order, and — inside the audit panel — a whole map+sort in render. None of it
// is expensive per item; all of it runs over the entire ranked pool, on a
// component whose parent re-renders on every add, every reach-out and every
// toggle. A memo boundary is invisible in a screenshot and silently deleted by
// the next edit, so the boundaries are pinned here by name and the reason each
// exists is written beside it.
//
// This is a SOURCE contract (the idiom of rate-limit-contract.test.ts): the
// components are React client modules the unit runner cannot render, and "this
// derivation sits behind a memo" is a property the source states.
//
// Runner: node:test via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  // CRLF-normalised: this checkout carries core.autocrlf=true and a marker
  // spanning a line break must not fail on the byte that ends the line.
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

type Boundary = { file: string; marker: string; why: string };

const BOUNDARIES: Boundary[] = [
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const cohorts = useMemo(",
    why: "eligible / pool-fit / early-career / experienced / not-eligible are ONE pass over `data`, not five re-derived per render",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const fairById = useMemo(() => indexFairnessMatrix(fairness), [fairness])",
    why: "the cross-scheme index is rebuilt only when the payload's matrix changes",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const orderRows = useCallback(",
    why: "a re-sort of the whole pool per render, and an unstable identity would defeat the memo below it",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const shownOrdered = useMemo(",
    why: "the array the active layout renders, and the input buildLadderRows is memoized on — an unstable identity rebuilds the whole row model every render",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const fairLookup = useMemo(",
    why: "the row model's `fair` lookup was an inline arrow re-created every render, defeating the memo it is passed to",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const addToPipeline = useCallback(",
    why: "a card's onAdd must be stable or the memoized card re-renders on every parent render",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const reachOut = useCallback(",
    why: "same, for the reach-out handler",
  },
  {
    file: "./jobsRecruiterCandidatesLogic.ts",
    marker: "const exportFairness = useCallback(",
    why: "the audit panel is memoized; its onExport must be stable",
  },
  {
    file: "./JobsRecruiterCandidates.tsx",
    marker: "const rows = useMemo(",
    why: "the shared row model (rank, band, strength/gap strips) is ONE pass over the ranked pool, not one per layout per render",
  },
  {
    file: "./JobsRecruiterCandidates.tsx",
    marker: "const notEligible = useMemo(",
    why: "the KO cohort's near-miss ordering is a sort over the whole not-eligible set",
  },
  {
    file: "./JobsRecruiterCandidatesFairness.tsx",
    marker: "export const FairnessAuditPanel = memo(function FairnessAuditPanel(",
    why: "the audit table is the heaviest derivation on the surface and changes only with the payload",
  },
  {
    file: "./JobsRecruiterCandidatesFairness.tsx",
    marker: "const rows = useMemo(",
    why: "map + sort over every candidate, previously executed in the render body on every parent render",
  },
  {
    file: "./JobsRow.tsx",
    marker: "export const JobRow = memo(function JobRow(",
    why: "the corpus table renders up to 500 of these; a filter keystroke must not rebuild every untouched row",
  },
];

for (const b of BOUNDARIES) {
  test(`${b.file} keeps its memo boundary: ${b.marker}`, () => {
    assert.ok(read(b.file).includes(b.marker), `${b.file} lost "${b.marker}" — ${b.why}`);
  });
}

// The two per-row hook calls that made a memoized row pointless: each row opened
// its own `enums` translator subscription. The labeller is stable and cheap to
// pass, so it is hoisted to the ONE place that renders the list.
test("row components take enumLabel as a prop instead of calling the hook per row", () => {
  for (const file of ["./JobsRow.tsx", "./JobsRediscoveryFeedRow.tsx"]) {
    const src = read(file);
    assert.ok(!src.includes("useEnumLabel()"), `${file} still calls useEnumLabel() per row`);
    assert.ok(src.includes("enumLabel"), `${file} should receive an enumLabel prop`);
  }
});

// The capped-sample caveat has to travel WITH the artifact. The amber note sits
// ~30 lines above the collapsed <details>, so a reviewer who opens the audit panel
// (or opens the exported CSV) can be reading a ranking over a subset with nothing
// on the screen or in the file saying so.
test("the fairness audit repeats the capped-sample caveat, in the panel and in the CSV", () => {
  const panel = read("./JobsRecruiterCandidatesFairness.tsx");
  assert.ok(panel.includes("poolTruncated"), "FairnessAuditPanel must receive the cap flag");
  assert.ok(panel.includes('t("auditPoolTruncated")'), "the panel must render the caveat inside the <details>");
  const logic = read("./jobsRecruiterCandidatesLogic.ts");
  assert.ok(
    logic.includes('t("auditPoolTruncated")'),
    "the exported CSV must carry the same caveat as the panel it is exported from"
  );
});

// THE FAIRNESS-LENS SURVIVAL CONTRACT. Three layouts over one pool is an invitation
// to let a caveat fall out of one of them — the KO-filtered cohort is the easiest
// thing in the world to leave out of a "compact card grid". Each variant must
// receive the cohort AND render it; the frame owns the cap note and the audit.
test("the Candidates ladder carries the KO-filtered cohort", () => {
  // One layout since the 2026-09 round picked the Ladder; the contract outlives
  // the switcher because it is about the claim, not the shape.
  for (const file of ["./candidates/CandidatesLadder.tsx"]) {
    const src = read(file);
    assert.ok(src.includes("notEligible"), `${file} must take the not-eligible cohort`);
    assert.ok(src.includes("koReasons"), `${file} must show WHY a candidate was filtered, not just that they were`);
  }
});

test("the frame keeps the capped-pool note and the fairness audit above the layouts", () => {
  const frame = read("./JobsRecruiterCandidates.tsx");
  assert.ok(frame.includes('t("poolTruncatedNote")'), "the cap note must live on the frame, not inside one layout");
  assert.ok(frame.includes("<FairnessAuditPanel"), "the cross-scheme audit must render for every layout");
  assert.ok(frame.includes('t("fairnessShielded")'), "the early-career fairness guarantee outlived its column and must still be stated");
});
