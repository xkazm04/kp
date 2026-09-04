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

const card = read(path.join(DIR, "DecisionsAiReviewCard.tsx"));
const head = read(path.join(DIR, "DecisionsShared.tsx"));
// The offer's salary band + pricingBasis render in the card's per-kind body,
// split out into its own module (DecisionsAiReviewCardBody.tsx); the matchBasis
// parse itself lives in decisionsAiReviewCardLogic.ts.
const cardBody = read(path.join(DIR, "DecisionsAiReviewCardBody.tsx"));
const cardLogic = read(path.join(DIR, "decisionsAiReviewCardLogic.ts"));

test("the card renders exactly ONE fit number, and the head renders none", () => {
  assert.ok(card.includes("<CandidateHead"), "the card still renders the candidate head");
  // One renderer, in the card header. Two would be the original defect (a header
  // score disagreeing with a body score at the money moment).
  assert.equal((card.match(/<ScoreBadge/g) ?? []).length, 1, "exactly one ScoreBadge in the card shell");
  assert.ok(!/ScoreBadge/.test(head), "CandidateHead must not render a second one");
  assert.ok(
    !/entry\.matchScore/.test(card) && !/entry\.matchScore/.test(head),
    "neither may read entry.matchScore directly — the canonical read path is the only door"
  );
});

test("the card resolves the score through the canonical read path and names its provenance", () => {
  assert.ok(
    /canonicalScoreOf\(entry\)/.test(card) && /provenanceOf\(entry\)/.test(card),
    "the card must resolve via canonicalScoreOf/provenanceOf (app/_lib/match-score.ts)"
  );
  // The provenance is no longer a printed label; it rides the badge's tooltip,
  // resolved through the SAME shared catalog the label used, so the wording still
  // cannot drift between the queue, the drawer and the board.
  assert.ok(
    /useScoreProvenanceText\(\)/.test(card),
    "the shown score must still say where it came from (shared scoreProvenance catalog)"
  );
  assert.ok(/title=\{provenanceText/.test(card), "…as the score badge's tooltip");
});

test("the pricing basis renders only under its own label (pricingBasis ← structured matchBasis), never a bare second match", () => {
  assert.ok(
    /matchBasis/.test(card) || /matchBasis/.test(cardBody) || /matchBasis/.test(cardLogic),
    "the draft-time fit check's matchBasis field must be read somewhere in the card, its body, or its logic module"
  );
  assert.ok(
    /t\("pricingBasis"/.test(cardBody),
    "the draft-time fit check must render through the labeled pricingBasis catalog key"
  );
});

// honest-unpriced-offer. draft_offer's FAIL SAFE (pipeline/jobfit/automation.py) emits
// recommended / salaryMin / salaryMax as null TOGETHER when neither the posting nor the
// active market carries a salary band — no figure is proposed, the candidate letter names
// none, and the draft routes to this human gate so a recruiter prices it. The card used to
// pull those nulls through `Number(x ?? 0).toLocaleString()`: a literal "0" headline and a
// 0–0 band meter — a fabricated number on exactly the drafts that exist BECAUSE nobody was
// willing to invent one. Source guard so a refactor can't quietly restore the coercion.
// The card is split three ways, so each half of the contract is asserted against the
// module that now owns it: the two derivations live in the logic module, the money
// headline in the card shell, the meter / band caption / pricing-basis line in the body.
test("an unpriced offer draft renders no fabricated figure and no 0–0 band meter", () => {
  assert.ok(
    /const unpriced =[\s\S]*?parsed\.recommended == null/.test(cardLogic),
    "the card's logic module must derive an `unpriced` state from a null `recommended`"
  );
  assert.ok(
    /const hasBand =[\s\S]*?parsed\.salaryMin != null && parsed\.salaryMax != null/.test(cardLogic),
    "the card's logic module must derive `hasBand` from BOTH bounds being present"
  );
  assert.ok(/unpriced \? \(/.test(card), "the money headline must branch on `unpriced` before formatting a figure");
  assert.ok(/\{hasBand \? \(/.test(cardBody), "the band meter + band caption must be gated on `hasBand`");
  assert.ok(
    /pricingBasis != null && hasBand \?/.test(cardBody),
    'the "~N% of the band" line needs a band — it must be gated on `hasBand` too'
  );
  assert.ok(
    /t\("noBand"\)/.test(cardBody) && /t\("unpricedAmount"\)/.test(card),
    "the unpriced state must render localized honest copy, not empty chrome"
  );
});

test("every catalog carries the unpriced-offer copy the card renders", () => {
  for (const locale of ["en", "cs", "de", "fr"] as const) {
    const messages = JSON.parse(read(path.join(REPO_ROOT, "messages", `${locale}.json`))) as {
      decisions: { aiReview: Record<string, string> };
    };
    const a = messages.decisions.aiReview;
    for (const key of ["noBand", "unpricedAmount", "unpricedTitle"]) {
      assert.ok((a[key]?.length ?? 0) > 0, `${locale}: decisions.aiReview.${key} must exist`);
    }
    assert.ok(!/\{min\}|\{max\}|\{currency\}/.test(a.noBand), `${locale}: noBand must not interpolate absent band bounds`);
  }
});

test("both catalogs carry the labels the contract renders (pricingBasis names the producer; scoreProvenance names the source)", () => {
  for (const locale of ["en", "cs"] as const) {
    const messages = JSON.parse(read(path.join(REPO_ROOT, "messages", `${locale}.json`))) as {
      decisions: { aiReview: Record<string, string> };
      scoreProvenance: Record<string, string>;
    };
    const pricing = messages.decisions.aiReview.pricingBasis;
    assert.ok(pricing?.includes("{score}"), `${locale}: pricingBasis interpolates the score`);
    assert.ok(
      // en pins the "fit check" term; cs may use the localized equivalent
      // "kontrola shody" (the i18n pass de-anglicized it) — both name the
      // producer, which is the contract; a bare "match"/"shoda" would not.
      /fit[- ]check|kontrol\S* shody/i.test(pricing),
      `${locale}: pricingBasis names the producer (a draft-time fit check), not a bare "match"`
    );
    assert.ok(messages.scoreProvenance.analysis.includes("{date}"), `${locale}: analysis provenance carries its date`);
    assert.ok(messages.scoreProvenance.snapshot.length > 0, `${locale}: snapshot provenance label exists`);
  }
});
