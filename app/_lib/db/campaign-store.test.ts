// The campaign pack store. `getCampaignPack` read its JSON column with
// `safeRowParse<unknown>(…)` and NO schema, while `intakes.ts` beside it passes one
// for every column it decodes — so a truncated write, a hand-edited row or a pack
// written by an older campaign_cli reached JobsCampaignTab as a `Pack`-shaped lie
// and rendered `undefined` into the recruiter's ad copy. The type assertion was the
// only thing standing between the column and the UI.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import { getCampaignPack, saveCampaignPack } from "./campaign.ts";
import { campaignPackSchema } from "../schemas.ts";

after(() => cleanupUnitDb());

const VARIANT = {
  hookType: "number",
  hook: "Ship Rust in Prague",
  adCopy: "We are hiring.",
  videoScript: { hook: "h", offer: "o", proof: "p", cta: "c" },
};
const PACK = { variants: [VARIANT], warnings: ["no_salary"], applyUrl: "https://example.test/apply", language: "en" };

/** Write a payload straight into the column, bypassing saveCampaignPack's JSON.stringify —
 *  the only way to reproduce a row that predates the current pack shape or was corrupted. */
function forceRow(jobId: string, lang: string, json: string, ws: string): void {
  ensureDb()
    .prepare(
      `INSERT INTO campaign_packs (job_id, lang, payload_json, source, created_at, workspace_id)
       VALUES (?, ?, ?, 'llm', ?, ?)`
    )
    .run(jobId, lang, json, new Date().toISOString(), ws);
}

test("a real pack round-trips intact, extra fields included", () => {
  const withExtra = { ...PACK, defaulted_fields: ["seniority"] };
  saveCampaignPack("job-rt", "en", withExtra, "llm", "ws-rt");
  const read = getCampaignPack("job-rt", "en", "ws-rt");
  assert.deepEqual(read?.payload, withExtra, "the schema is a floor, not a filter — campaign_cli may add fields");
  assert.equal(read?.source, "llm");
});

test("a pack that is not an object at all is refused, not handed to the tab", () => {
  for (const [i, json] of ['"just a string"', "42", "null", "[1, 2, 3]", "{ bad json"].entries()) {
    forceRow(`job-bad-${i}`, "en", json, "ws-bad");
    assert.equal(getCampaignPack(`job-bad-${i}`, "en", "ws-bad"), null, `payload ${json} must not decode`);
  }
});

test("a structurally wrong variant is refused rather than rendered as undefined", () => {
  // The Campaign tab reads v.hook / v.adCopy / v.videoScript.<beat> directly. Before
  // the schema, each of these decoded happily and painted "undefined" into copy a
  // recruiter was about to publish.
  const broken = [
    { variants: ["alpha"] }, // a bare string where a variant belongs
    { variants: [{ ...VARIANT, videoScript: { hook: "h" } }] }, // a half-written script
    { variants: [{ hook: "h" }] }, // missing hookType/adCopy/videoScript
    { variants: "alpha" }, // not a list
    { warnings: [{ code: "no_salary" }] }, // warnings are codes, not objects
  ];
  for (const [i, payload] of broken.entries()) {
    forceRow(`job-broken-${i}`, "en", JSON.stringify(payload), "ws-broken");
    assert.equal(
      getCampaignPack(`job-broken-${i}`, "en", "ws-broken"),
      null,
      `payload ${JSON.stringify(payload)} must not reach the tab`
    );
  }
});

test("an optional per-variant link is optional, so pre-attribution packs still decode", () => {
  // variantId/applyUrl were added by the E5 per-variant &v= attribution work; packs
  // generated before it must keep rendering.
  assert.equal(campaignPackSchema.safeParse(PACK).success, true);
  assert.equal(campaignPackSchema.safeParse({ variants: [{ ...VARIANT, variantId: "v1", applyUrl: "https://x.test" }] }).success, true);
  // An empty pack is legal too: campaign.py can answer warnings and no variants.
  assert.equal(campaignPackSchema.safeParse({ warnings: ["no_skills"] }).success, true);
  assert.equal(campaignPackSchema.safeParse({}).success, true);
});
