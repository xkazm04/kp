// Executing coverage for the dwell band's in-place cadence write (challenge-r05
// analytics-metrics/B, case 7 as the critic restated it: pure, no component render).
//
// The cadence input writes through the r03 route, PATCH /api/pipeline/stage-sla, which
// answers a refusal with a CODE. DECISION_CONFIG_INVALID's generic catalog line ("Those
// rules aren't valid for this phase.") says nothing to someone who just typed 400 into
// a days field, so the plan maps that code to the band's own sentence; every other code
// resolves through the errors catalog; the server's English `error` is never the answer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cadenceFailureMessage, cadenceSaveRequest } from "./stageCadenceSavePlan";

const LOCALES = ["en", "cs", "de", "fr"] as const;
type Catalog = { errors: Record<string, string>; analytics: Record<string, unknown> };
const catalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Catalog;

test("the request is one column's PATCH on the team's cadence route", () => {
  const req = cadenceSaveRequest("Tech round", 10);
  assert.equal(req.url, "/api/pipeline/stage-sla");
  assert.equal(req.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(req.init.body)), { stage: "Tech round", days: 10 });
  assert.deepEqual(JSON.parse(String(cadenceSaveRequest("Interview", null).init.body)), { stage: "Interview", days: null }, "an emptied field clears back to the default");
});

for (const locale of LOCALES) {
  test(`${locale}: a DECISION_CONFIG_INVALID refusal reads as the cadence sentence, other codes as their own`, () => {
    const c = catalog(locale);
    const invalid = c.analytics.stageCadenceInvalid;
    const fallback = c.analytics.stageCadenceFailed;
    assert.equal(typeof invalid, "string", `${locale} must carry analytics.stageCadenceInvalid`);
    assert.equal(typeof fallback, "string", `${locale} must carry analytics.stageCadenceFailed`);
    const resolveError = (payload: { code?: string | null } | null | undefined, fb: string) =>
      payload?.code && c.errors[payload.code] ? c.errors[payload.code] : fb;
    const server = "days must be a whole number from 1 to 365, or null.";

    const refused = cadenceFailureMessage({ code: "DECISION_CONFIG_INVALID", error: server }, resolveError, invalid as string, fallback as string);
    assert.equal(refused, invalid);
    assert.notEqual(refused, server, "the server's English never reaches the field");

    const forbidden = cadenceFailureMessage({ code: "FORBIDDEN_CAPABILITY", error: "nope" }, resolveError, invalid as string, fallback as string);
    assert.equal(forbidden, c.errors.FORBIDDEN_CAPABILITY, "a seat without pipeline:write is told so in its language");

    assert.equal(cadenceFailureMessage({}, resolveError, invalid as string, fallback as string), fallback, "a body-less failure falls back to the caller's sentence");
  });
}
