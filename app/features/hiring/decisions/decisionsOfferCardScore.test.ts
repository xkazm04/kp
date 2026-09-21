// Contract test for the offer approval card's ONE-labeled-score rule
// (REC-01 / OO-L2-10). The card used to show three unreconciled numbers at the
// money moment: "57 SHODA" in the header (entry.matchScore), "Match 49/100" in
// the salary rationale (the draft-time fresh fit check that actually priced the
// offer), and a third analysis score one click away in the drawer. The contract
// now is:
//
//   - the header renders exactly ONE fit number, resolved through the canonical
//     read path (canonicalScoreOf/provenanceOf, app/_lib/match-score.ts), and it
//     names its provenance. 2026-09: that number moved OUT of CandidateHead into
//     the card's own header corner (beside the verdict), and its provenance moved
//     from a printed label to the badge's tooltip — the label cost a line on every
//     card and the score cost the role line half its width. The contract is
//     unchanged in substance: ONE number, canonically resolved, saying where it
//     came from; only its owner moved, so the assertions follow it;
//   - the pricing basis is a genuinely different producer and renders ONLY
//     under its own label (the `pricingBasis` catalog key reading the
//     structured `matchBasis` field) — never as bare prose "Match N/100".
//
// kp convention: a source-level guard (like the `matchScore ?? 0` walk in
// match-score.test.ts) so a refactor that quietly reintroduces a second
// unlabeled score fails CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIR, "..", "..", "..", "..");
const read = (p: string) => readFileSync(p, "utf8");

// 2026-09: the card grid became the decisions LEDGER (ledger/) and the card's header
// + actions moved into the candidate modal's decision bar (candidate/decision/).
// The ONE fit number is now the ledger row's score cell — resolved by the row model
// through the canonical read path — and the decision bar renders NO fit number at
// all: the modal's Overview beside it is the canonical read.
const model = read(path.join(DIR, "ledger", "decisionsLedgerModel.ts"));
const cells = read(path.join(DIR, "ledger", "LedgerCells.tsx"));
const bar = read(path.join(REPO_ROOT, "app", "features", "hiring", "pipeline", "candidate", "decision", "CandidateDecisionBar.tsx"));
const head = read(path.join(DIR, "DecisionsShared.tsx"));
const cardBody = read(path.join(DIR, "DecisionsAiReviewCardBody.tsx"));
const cardLogic = read(path.join(DIR, "decisionsAiReviewCardLogic.ts"));

test("the ledger renders exactly ONE fit number per row, and the decision bar renders none", () => {
  assert.equal((cells.match(/<ScoreBadge/g) ?? []).length, 1, "exactly one ScoreBadge in the shared cells");
  assert.ok(!/ScoreBadge/.test(bar), "the decision bar must not render a second one");
  assert.ok(!/ScoreBadge/.test(head), "CandidateHead must not render one either");
  assert.ok(
    !/entry\.matchScore/.test(model) && !/entry\.matchScore/.test(bar) && !/entry\.matchScore/.test(head),
    "none may read entry.matchScore directly — the canonical read path is the only door"
  );
});

test("the row model resolves the score through the canonical read path", () => {
  assert.ok(/canonicalScoreOf\(entry\)/.test(model), "the row model must resolve via canonicalScoreOf (app/_lib/match-score.ts)");
});

test("the pricing basis renders only under its own label, from the structured field", () => {
  assert.ok(
    /matchBasis/.test(bar) || /matchBasis/.test(cardBody) || /matchBasis/.test(cardLogic),
    "the draft-time fit check's matchBasis field must be read in the bar, the offer body, or the logic module"
  );
  assert.ok(/t\("pricingBasis"/.test(cardBody), "…and rendered under the pricingBasis label");
  assert.ok(!/Match \d+\/100/.test(cardBody) && !/Match \d+\/100/.test(bar), "never as bare prose");
});
