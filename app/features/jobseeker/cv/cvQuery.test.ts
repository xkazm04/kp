import { test } from "node:test";
import assert from "node:assert/strict";
import { CV_DESIGN_DEFAULT, cvDesignQuery, cvPrintPath, parseCvDesign } from "./cvQuery";

// The preview, /me/cv/print and GET /api/jobseeker/cv.pdf build the same sheet only if
// the same URL keys reach all three: the PDF route hands headless Chromium `cvPrintPath`
// of its own query.

const get = (q: string) => {
  const p = new URLSearchParams(q);
  return (k: string) => p.get(k);
};

test("defaults, and anything out of vocabulary falls back to them", () => {
  assert.deepEqual(parseCvDesign(get("")), CV_DESIGN_DEFAULT);
  assert.deepEqual(parseCvDesign(get("template=poster&accent=gold&tailor=-1&compact=yes&objective=no")), CV_DESIGN_DEFAULT);
  assert.equal(parseCvDesign(get("tailor=1.5")).tailor, null);
  assert.equal(parseCvDesign(get("tailor=99")).tailor, null);
  // A server page's searchParams may carry an array.
  assert.equal(parseCvDesign((k) => (k === "tailor" ? ["2", "3"] : undefined)).tailor, 2);
});

test("the PDF route passes the tailoring through to the print page", () => {
  assert.equal(cvPrintPath(new URLSearchParams("template=compact&accent=moss&tailor=1&compact=1&objective=0")), "/me/cv/print?template=compact&accent=moss&tailor=1&compact=1&objective=0");
  assert.equal(cvPrintPath(new URLSearchParams("tailor=0")), "/me/cv/print?template=sidebar&accent=navy&tailor=0");
});

test("untailored, the tailoring keys stay off the URL; nothing foreign rides along", () => {
  assert.equal(cvPrintPath(new URLSearchParams("template=editorial&compact=1&objective=0&next=//evil.example")), "/me/cv/print?template=editorial&accent=navy");
  const design = { ...CV_DESIGN_DEFAULT, tailor: 0, compact: true, objective: false };
  assert.deepEqual(parseCvDesign(get(cvDesignQuery(design))), design);
});
