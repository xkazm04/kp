import { test } from "node:test";
import assert from "node:assert/strict";
import { CV_DESIGN_DEFAULT, CV_DESIGN_VERSION, CV_SINGLE_FLOW, CV_TEMPLATES, cvDesignQuery, cvPrintPath, migrateSavedCvDesign, parseCvDesign, parseSavedCvDesign } from "./cvQuery";

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
  assert.equal(cvPrintPath(new URLSearchParams("tailor=0")), "/me/cv/print?template=classic&accent=navy&tailor=0");
});

test("untailored, the tailoring keys stay off the URL; nothing foreign rides along", () => {
  assert.equal(cvPrintPath(new URLSearchParams("template=editorial&compact=1&objective=0&next=//evil.example")), "/me/cv/print?template=editorial&accent=navy");
  const design = { ...CV_DESIGN_DEFAULT, tailor: 0, compact: true, objective: false };
  assert.deepEqual(parseCvDesign(get(cvDesignQuery(design))), design);
});

test("the default layout is the single-flow one, and every layout says whether it is", () => {
  // Registry recruiting/cv-presentation-and-parseability, parse-safe-reading-order: one
  // flow is the default; a columned layout is an opt-in.
  assert.equal(CV_DESIGN_DEFAULT.template, "classic");
  assert.equal(CV_SINGLE_FLOW[CV_DESIGN_DEFAULT.template], true);
  assert.deepEqual(Object.keys(CV_SINGLE_FLOW).sort(), [...CV_TEMPLATES].sort());
  assert.equal(parseCvDesign(get("template=sidebar")).template, "sidebar");
});

test("a saved sidebar from before the version marker reads as never chosen - once", () => {
  // The designer wrote the design on every mount, so an old `sidebar` is the old default.
  const old = parseSavedCvDesign({ template: "sidebar", accent: "moss", tailor: 1, compact: true, objective: false })!;
  assert.equal(old.v, undefined);
  const migrated = migrateSavedCvDesign(old);
  assert.deepEqual(migrated, { template: "classic", accent: "moss", tailor: 1, compact: true, objective: false, v: CV_DESIGN_VERSION });
  // Saved back with the marker, it passes through untouched - the same object.
  const again = parseSavedCvDesign(JSON.parse(JSON.stringify(migrated)))!;
  assert.equal(again.v, CV_DESIGN_VERSION);
  assert.equal(migrateSavedCvDesign(again), again);
  // After the migration, a seeker who PICKS sidebar keeps it.
  const picked = parseSavedCvDesign({ template: "sidebar", accent: "navy", tailor: null, compact: false, objective: true, v: 2 })!;
  assert.equal(migrateSavedCvDesign(picked).template, "sidebar");
  // Only the old default is reset: an old editorial or compact choice stands, marked.
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "editorial" })!).template, "editorial");
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "compact", v: 1 })!).template, "compact");
  assert.equal(parseSavedCvDesign(null), null);
  assert.equal(parseSavedCvDesign(["sidebar"]), null);
});

test("the version marker never rides a URL, and a URL's sidebar is always a choice", () => {
  assert.equal(parseCvDesign(get("template=sidebar")).template, "sidebar");
  assert.equal("v" in parseCvDesign(get("template=sidebar")), false);
  assert.equal(cvDesignQuery({ ...CV_DESIGN_DEFAULT, template: "sidebar", v: CV_DESIGN_VERSION }), "template=sidebar&accent=navy");
  assert.equal(cvPrintPath(new URLSearchParams("template=sidebar&v=2")), "/me/cv/print?template=sidebar&accent=navy");
});
