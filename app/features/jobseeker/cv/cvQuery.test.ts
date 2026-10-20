import { test } from "node:test";
import assert from "node:assert/strict";
import { CV_ACCENTS, CV_DESIGN_DEFAULT, CV_DESIGN_VERSION, CV_SINGLE_FLOW, CV_TEMPLATES, cvDesignQuery, cvPrintPath, migrateSavedCvDesign, parseCvDesign, parseSavedCvDesign } from "./cvQuery";

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

test("every layout and accent round-trips through the URL", () => {
  for (const template of CV_TEMPLATES) {
    for (const accent of CV_ACCENTS) {
      const d = parseCvDesign(get(cvDesignQuery({ ...CV_DESIGN_DEFAULT, template, accent })));
      assert.equal(d.template, template);
      assert.equal(d.accent, accent);
    }
  }
});

test("the PDF route passes the tailoring through to the print page", () => {
  assert.equal(cvPrintPath(new URLSearchParams("template=compact&accent=moss&tailor=1&compact=1&objective=0")), "/me/cv/print?template=compact&accent=moss&tailor=1&compact=1&objective=0");
  assert.equal(cvPrintPath(new URLSearchParams("tailor=0")), "/me/cv/print?template=studio&accent=cobalt&tailor=0");
});

test("untailored, the tailoring keys stay off the URL; nothing foreign rides along", () => {
  assert.equal(cvPrintPath(new URLSearchParams("template=editorial&compact=1&objective=0&next=//evil.example")), "/me/cv/print?template=editorial&accent=cobalt");
  const design = { ...CV_DESIGN_DEFAULT, tailor: 0, compact: true, objective: false };
  assert.deepEqual(parseCvDesign(get(cvDesignQuery(design))), design);
});

test("the default layout is a single-flow one, and every layout says whether it is", () => {
  // Registry recruiting/cv-presentation-and-parseability, parse-safe-reading-order: one
  // flow is the default; a columned layout is an opt-in. Restated from `npm run
  // cv:roundtrip`: the five single-flow layouts pass both extractors on every reference
  // CV; sidebar and compact are read out of order by position.
  assert.equal(CV_DESIGN_DEFAULT.template, "studio");
  assert.equal(CV_SINGLE_FLOW[CV_DESIGN_DEFAULT.template], true);
  assert.deepEqual(Object.keys(CV_SINGLE_FLOW).sort(), [...CV_TEMPLATES].sort());
  assert.deepEqual(
    CV_TEMPLATES.filter((t) => !CV_SINGLE_FLOW[t]),
    ["sidebar", "compact"]
  );
  // The picker's order: the default first, the columned ones last.
  assert.equal(CV_TEMPLATES[0], CV_DESIGN_DEFAULT.template);
  assert.deepEqual(CV_TEMPLATES.slice(-2), ["sidebar", "compact"]);
  assert.equal(parseCvDesign(get("template=sidebar")).template, "sidebar");
});

test("a saved design reads the default of its day as never chosen - once", () => {
  // Unmarked: the designer wrote the design on every mount, so an old `sidebar` (and the
  // old `navy`) is the old default.
  const old = parseSavedCvDesign({ template: "sidebar", accent: "navy", tailor: 1, compact: true, objective: false })!;
  assert.equal(old.v, undefined);
  const migrated = migrateSavedCvDesign(old);
  assert.deepEqual(migrated, { template: "studio", accent: "cobalt", tailor: 1, compact: true, objective: false, v: CV_DESIGN_VERSION });
  // Saved back with the marker, it passes through untouched - the same object.
  const again = parseSavedCvDesign(JSON.parse(JSON.stringify(migrated)))!;
  assert.equal(again.v, CV_DESIGN_VERSION);
  assert.equal(migrateSavedCvDesign(again), again);

  // v2: `classic` in `navy` was the default then - it reads as the new default, once.
  const v2 = migrateSavedCvDesign(parseSavedCvDesign({ template: "classic", accent: "navy", tailor: null, compact: false, objective: true, v: 2 })!);
  assert.deepEqual(v2, { ...CV_DESIGN_DEFAULT, v: CV_DESIGN_VERSION });
  // A v2 choice of anything else stands, field by field.
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "sidebar", accent: "plum", v: 2 })!).template, "sidebar");
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "sidebar", accent: "plum", v: 2 })!).accent, "plum");
  assert.deepEqual(migrateSavedCvDesign(parseSavedCvDesign({ template: "classic", accent: "moss", v: 2 })!).accent, "moss");
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "editorial", accent: "navy", v: 2 })!).template, "editorial");
  // Unmarked `classic` was a choice (made while `sidebar` was the default); it stands.
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "classic" })!).template, "classic");
  assert.equal(migrateSavedCvDesign(parseSavedCvDesign({ template: "compact", v: 1 })!).template, "compact");

  // After the migration, a seeker who PICKS a former default keeps it.
  const picked = parseSavedCvDesign({ template: "classic", accent: "navy", tailor: null, compact: false, objective: true, v: CV_DESIGN_VERSION })!;
  assert.equal(migrateSavedCvDesign(picked).template, "classic");
  assert.equal(migrateSavedCvDesign(picked).accent, "navy");
  assert.equal(parseSavedCvDesign(null), null);
  assert.equal(parseSavedCvDesign(["sidebar"]), null);
});

test("the version marker never rides a URL, and a URL's template is always a choice", () => {
  assert.equal(parseCvDesign(get("template=classic&accent=navy")).template, "classic");
  assert.equal("v" in parseCvDesign(get("template=sidebar")), false);
  assert.equal(cvDesignQuery({ ...CV_DESIGN_DEFAULT, template: "sidebar", v: CV_DESIGN_VERSION }), "template=sidebar&accent=cobalt");
  assert.equal(cvPrintPath(new URLSearchParams("template=sidebar&v=2")), "/me/cv/print?template=sidebar&accent=cobalt");
  assert.equal(cvPrintPath(new URLSearchParams("template=classic&accent=navy&v=2")), "/me/cv/print?template=classic&accent=navy");
});
