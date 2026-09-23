// Pins the Analyze intake router (challenge-r03 cv-analyze-intake/A).
//
// Every file that reaches the Analyze form — a drop anywhere on the page, a drop
// on a labeled zone, a click in a zone's picker — is decided by ONE pure plan:
// `resolveDropZone(target)` names the zone from the `data-file-dropzone` id on the
// nearest marked ancestor, and `planDrop(zone, files, snapshot)` says where each
// file goes and names a reason for every file that does not go in. Before this,
// the decision was spread over a window listener inside the CV column, three
// per-zone onDrop handlers, an owned-zone carve-out attribute and a prop-order
// override, and four drops were lost without a word:
//
//   1. a file dropped on the ATTACHED JD/company card (owned, but no handler);
//   2. every file after the first in a multi-file JD/company drop;
//   3. every valid CV after an invalid one in a batch;
//   4. "page" could only ever mean CV, because the page catch lived in the CV column.
//
// Still pinned from idea-1a75b476: a drop on the JD/company zone never ALSO becomes
// a phantom CV variant — a plan names exactly one destination per file.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DROP_ZONES,
  DROP_ZONE_ATTR,
  dropZoneProps,
  isDropZone,
  planDrop,
  resolveDropZone,
} from "./analyzeDropRouting.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// A stand-in for a drop event target. `closest()` resolves the nearest ancestor
// carrying the zone attribute, exactly like Element.closest does in the browser,
// and that ancestor answers getAttribute() with the zone id it was marked with.
// `inside()` with no zone models a drop in bare page space.
function inside(zone?: string): EventTarget {
  return {
    closest(selectors: string) {
      if (zone === undefined) return null;
      assert.equal(selectors, `[${DROP_ZONE_ATTR}]`, "the router must look the zone up by its attribute");
      return { getAttribute: (name: string) => (name === DROP_ZONE_ATTR ? zone : null) };
    },
  } as unknown as EventTarget;
}

const pdf = (name: string, bytes = 1) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

// ── Case 1: the zone comes from the id on the nearest marked ancestor ─────────
test("resolveDropZone reads the zone id off the nearest [data-file-dropzone] ancestor", () => {
  assert.equal(resolveDropZone(inside("jd")), "jd");
  assert.equal(resolveDropZone(inside("company")), "company");
  assert.equal(resolveDropZone(inside("cv")), "cv");
  // No marked ancestor, a text node (no closest), the document, nothing at all.
  assert.equal(resolveDropZone(inside()), "page");
  assert.equal(resolveDropZone({ nodeType: 3 } as unknown as EventTarget), "page");
  assert.equal(resolveDropZone({} as EventTarget), "page");
  assert.equal(resolveDropZone(null), "page");
  // A marker carrying a value outside the closed vocabulary is not a zone.
  assert.equal(resolveDropZone(inside("")), "page");
  assert.equal(resolveDropZone(inside("resume")), "page");
});

test("the zone vocabulary is closed and the marker spreads its id", () => {
  assert.deepEqual([...DROP_ZONES], ["cv", "jd", "company"]);
  assert.equal(isDropZone("jd"), true);
  assert.equal(isDropZone("page"), false, "page is where a drop lands, not a zone a component can claim");
  assert.equal(isDropZone(undefined), false);
  assert.deepEqual(dropZoneProps("company"), { [DROP_ZONE_ATTR]: "company" });
});

// ── Case 2: a page drop fills the CV column while there is room ──────────────
test("a page drop of two CVs with room for both files both, refuses nothing", () => {
  const a = pdf("a.pdf");
  const b = new File(["b"], "b.docx");
  assert.deepEqual(planDrop("page", [a, b], { cvCount: 1, maxCv: 3, hasJdFile: false, hasCompanyFile: false }), {
    cv: [a, b],
    jd: null,
    company: null,
    refused: [],
  });
});

// ── Case 3: the cap refuses by name, not by silence ──────────────────────────
test("a page drop past the CV cap names every file it could not add", () => {
  const [a, b, c] = [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")];
  const plan = planDrop("page", [a, b, c], { cvCount: 2, maxCv: 3 });
  assert.deepEqual(plan?.cv, [a]);
  assert.deepEqual(plan?.refused, [
    { file: b, reason: "cap" },
    { file: c, reason: "cap" },
  ]);
});

// ── Case 4: the gate runs per file and a rejection does not stop the batch ───
test("an invalid file in a CV batch is refused with its code and the valid ones after it still go in", () => {
  const bad = new File(["x"], "bad.png", { type: "image/png" });
  const good = pdf("good.pdf");
  const huge = pdf("huge.pdf", 9 * 1024 * 1024);
  const plan = planDrop("cv", [bad, good, huge], { cvCount: 0, maxCv: 3 });
  assert.deepEqual(plan?.cv, [good]);
  assert.deepEqual(plan?.refused, [
    { file: bad, reason: "UPLOAD_UNSUPPORTED_TYPE" },
    { file: huge, reason: "UPLOAD_TOO_LARGE" },
  ]);
});

// ── Case 5: a single slot keeps the first file and names the rest ────────────
test("a two-file drop on the JD zone takes the first and refuses the second as single-slot", () => {
  const [jd1, jd2] = [pdf("jd1.pdf"), pdf("jd2.pdf")];
  const plan = planDrop("jd", [jd1, jd2], { hasJdFile: false });
  assert.deepEqual(plan?.jd, { file: jd1, replaces: false });
  assert.deepEqual(plan?.refused, [{ file: jd2, reason: "single-slot" }]);
  assert.deepEqual(plan?.cv, [], "a JD-zone drop never becomes a phantom CV variant");
  assert.equal(plan?.company, null);
});

// ── Case 6: a drop on a FILLED slot replaces it ──────────────────────────────
test("a drop on an attached JD or company card replaces the attachment", () => {
  const x = pdf("x.pdf");
  const jdPlan = planDrop("jd", [x], { hasJdFile: true });
  assert.deepEqual(jdPlan?.jd, { file: x, replaces: true });
  assert.deepEqual(jdPlan?.refused, []);

  const y = new File(["# About us"], "y.md", { type: "text/markdown" });
  const companyPlan = planDrop("company", [y], { hasCompanyFile: true });
  assert.deepEqual(companyPlan?.company, { file: y, replaces: true });
  assert.equal(companyPlan?.jd, null);
  assert.deepEqual(companyPlan?.cv, []);
});

// ── Case 7: only a genuine file drag with files is ever routed ───────────────
test("a non-file drag, or a drag with no files, is never routed wherever it lands", () => {
  for (const zone of ["page", "cv", "jd", "company"] as const) {
    assert.equal(planDrop(zone, [pdf("a.pdf")], { isFileDrag: false }), null, `${zone}: text-selection drag`);
    assert.equal(planDrop(zone, [], {}), null, `${zone}: no files`);
  }
});

// ── Source guards: the zones carry their ids and the old carve-out is gone ───
test("each Analyze zone is marked with its own id, not a bare owned marker", () => {
  const dropZone = read("./AnalyzeFileDropZone.tsx");
  assert.match(dropZone, /dropZoneProps\(zone\)/, "the JD/company zone marks itself with the id it was given");
  const columns = read("./AnalyzeFormOptionalColumns.tsx");
  assert.match(columns, /zone="jd"/);
  assert.match(columns, /zone="company"/);
  const profile = read("./AnalyzeProfileInput.tsx");
  assert.match(profile, /dropZoneProps\("cv"\)/, "the empty CV zone is marked cv");
  const router = read("./analyzeDropRouting.ts");
  assert.doesNotMatch(router, /export (const|function) (ownedDropZoneProps|resolveWindowDropTarget)\b/, "the owned-zone carve-out retired");
});

test("the drop-anywhere overlay lives on the form and names the JD/company carve-out (idea-9f3a1c52)", () => {
  // "Drop your CV anywhere" alone implies the labeled Job description and Company
  // zones too — but those keep their own files. The overlay is now rendered once,
  // by the form that hosts the router, and still spells the carve-out out.
  const form = read("./AnalyzeForm.tsx");
  assert.match(form, /t\("dropCarveout"\)/, "the overlay must render the carve-out message");
  assert.doesNotMatch(read("./AnalyzeProfileInput.tsx"), /t\("dropCarveout"\)/, "the CV column no longer builds the page overlay");
  assert.doesNotMatch(read("./AnalyzeProfileInputFileList.tsx"), /dragOverlay/, "the overlay is not threaded through the list as a prop");
  const en = JSON.parse(read("../../../../messages/en.json")) as { analyze?: { dropCarveout?: string } };
  assert.match(en.analyze?.dropCarveout ?? "", /Job description and Company zones keep their own files/);
});
