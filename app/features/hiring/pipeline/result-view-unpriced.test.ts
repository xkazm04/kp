// unpriced-offer-twin. CandidateResultView's offer block was the exact untreated twin
// of the approval card fixed in c693303 (feat(decisions): honest-unpriced-offer).
//
// draft_offer's FAIL SAFE (pipeline/jobfit/automation.py) emits recommended / salaryMin /
// salaryMax as null TOGETHER when neither the posting nor the active market carries a
// salary band — no figure is proposed, the candidate letter names none, and the draft
// routes to the human offer_review gate so a recruiter prices it. This view pulled those
// nulls through `Number(x ?? 0).toLocaleString()`: a literal "0" money headline and a 0–0
// band meter with the marker pinned at the floor. It additionally defaulted the unit via
// `String(d.currency ?? "CZK")` — mislabelling the amount for every non-CZK market, on a
// draft that carries no amount at all.
//
// kp convention: a source-level guard (mirroring offer-card-score.test.ts, which c693303
// added for the twin) so a refactor can't quietly restore the coercion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIR, "..", "..", "..", "..");
const read = (p: string) => readFileSync(p, "utf8");

const view = read(path.join(DIR, "PipelineCandidateResultView.tsx"));
/** Comment-free source: the fix's own post-mortem comment quotes the old `?? "CZK"`
 *  default deliberately, and must not read as the defect still being present. */
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the offer result view derives the unpriced/hasBand flags the twin card uses", () => {
  assert.ok(
    /const unpriced =[\s\S]*?d\.recommended == null/.test(view),
    "the view must derive an `unpriced` state from a null `recommended`"
  );
  assert.ok(
    /const hasBand =[\s\S]*?d\.salaryMin != null && d\.salaryMax != null/.test(view),
    "the view must derive `hasBand` from BOTH bounds being present"
  );
  assert.ok(/unpriced \? \(/.test(view), "the money headline must branch on `unpriced` before formatting a figure");
  assert.ok(/\{hasBand \? \(/.test(view), "the band meter + band caption must be gated on `hasBand`");
  assert.ok(
    /t\("noBand"\)/.test(view) && /t\("unpricedAmount"\)/.test(view) && /t\("unpricedTitle"\)/.test(view),
    "the unpriced state must render localized honest copy, not empty chrome"
  );
});

test("no `Number(x ?? 0)` money coercion survives in the offer block", () => {
  // The precise defect shape: a null salary field defaulted to 0 and then formatted as
  // if it were a real, proposed figure.
  for (const field of ["recommended", "salaryMin", "salaryMax"]) {
    assert.equal(
      new RegExp(`Number\\(d\\.${field} \\?\\? 0\\)`).test(viewCode),
      false,
      `d.${field} must not be coerced through \`?? 0\` — a null there means "not priced", not zero`
    );
  }
});

test('the currency is never defaulted to "CZK"', () => {
  // The server labels the offer in the ACTIVE market's currency and refuses to invent
  // one; a `?? "CZK"` default silently mislabels every non-CZK market.
  assert.equal(/currency \?\? "CZK"/.test(viewCode), false, 'no `?? "CZK"` fallback may reappear');
  assert.equal(/"CZK"/.test(viewCode), false, "the view must name no hardcoded currency at all");
});

test("every catalog carries the unpriced-offer copy this view renders", () => {
  for (const locale of ["en", "cs", "de", "fr"] as const) {
    const messages = JSON.parse(read(path.join(REPO_ROOT, "messages", `${locale}.json`))) as {
      pipeline: { result: Record<string, string> };
    };
    const r = messages.pipeline.result;
    for (const key of ["noBand", "unpricedAmount", "unpricedTitle"]) {
      assert.ok((r[key]?.length ?? 0) > 0, `${locale}: pipeline.result.${key} must exist`);
    }
    assert.ok(
      !/\{min\}|\{max\}|\{currency\}/.test(r.noBand),
      `${locale}: noBand must not interpolate band bounds that, by definition, are absent`
    );
  }
});
