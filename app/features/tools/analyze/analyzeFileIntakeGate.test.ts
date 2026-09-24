// Guards the "every File goes through one gate" contract (idea-c9abc53f), now held
// by the intake router (challenge-r03 cv-analyze-intake/A).
//
// The Analyze workspace has several File entry points — a drop anywhere, a drop on
// a labeled zone, the empty CV picker, Add-variant, Replace, the sample CV, a
// pasted CV. They used to validate inconsistently (a 20 MB PNG used to Replace a
// CV slipped in and only failed server-side), then all went through a per-component
// `useFileAccept` gate — which still let the drop and the click diverge, because
// each component decided for itself. The decision now lives in ONE pure plan
// (`planDrop` / `planSingleSlot` in analyzeDropRouting.ts, which runs
// `acceptUpload` per file), and ONE window listener hosted by the form feeds it.
//
// There is no render/DOM test layer in this repo, so these are source-level guards.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

/** Source with comments removed, so prose ABOUT an old shape cannot satisfy or
 *  trip an assertion about code. */
function code(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const ANALYZE_SURFACES = [
  "./AnalyzeForm.tsx",
  "./AnalyzeProfileInput.tsx",
  "./AnalyzeProfileInputFileList.tsx",
  "./AnalyzeFileDropZone.tsx",
  "./AnalyzeFormOptionalColumns.tsx",
];

// ── Case 8: exactly one window-level drop listener, counted by the shared arithmetic
test("exactly ONE window-level drop listener serves the Analyze form, hosted by AnalyzeForm", () => {
  const callers = ANALYZE_SURFACES.filter((rel) => /\buseGlobalFileDrag\s*\(/.test(code(rel)));
  assert.deepEqual(callers, ["./AnalyzeForm.tsx"], "useGlobalFileDrag must be called from AnalyzeForm.tsx only");
  assert.equal((code("./AnalyzeForm.tsx").match(/\buseGlobalFileDrag\s*\(/g) ?? []).length, 1);

  const hook = code("./useAnalyzeGlobalFileDrag.ts");
  assert.match(hook, /nextDragDepth\(/, "the window hook derives its depth from the shared reducer");
  assert.doesNotMatch(hook, /\bdragCounter\b/, "no inline counter beside the shared arithmetic");
  assert.doesNotMatch(hook, /\+=\s*1|-=\s*1|\+\+|--/, "no hand-rolled increment/decrement");
  assert.match(hook, /resolveDropZone\(/, "the window drop resolves a zone id, not an owned/unowned bit");
  assert.equal((hook.match(/addEventListener\("drop"/g) ?? []).length, 1);
});

test("no zone component commits a dropped file itself — zones keep only the counted highlight", () => {
  const highlight = code("./useAnalyzeDropZoneHighlight.ts");
  assert.doesNotMatch(highlight, /dataTransfer\.files\?\.\[0\]/, "the zone hook no longer commits files[0]");
  const profile = code("./AnalyzeProfileInput.tsx");
  assert.doesNotMatch(profile, /onDrop=\{/, "the empty CV zone no longer overrides the hook's onDrop by spread order");
  assert.doesNotMatch(profile, /dataTransfer/, "the CV column reads no drop payload");
});

test("every Analyze File entry point plans through the router, never through a per-component gate", () => {
  for (const rel of ANALYZE_SURFACES) {
    const src = code(rel);
    assert.doesNotMatch(src, /useFileAccept|acceptUpload|validateUpload/, `${rel} must not keep its own gate`);
  }
  // The form applies the plan it is handed; the router module owns the gate.
  assert.match(code("./useAnalyzeFileAccept.ts"), /planDrop\(/, "the form's intake applies planDrop");
  assert.match(code("./analyzeDropRouting.ts"), /acceptUpload\(/, "the plan runs acceptUpload per file");
  // The raw CV mutators are reached only through the intake, never from a column.
  for (const rel of ["./AnalyzeProfileInput.tsx", "./AnalyzeProfileInputFileList.tsx"]) {
    assert.doesNotMatch(code(rel), /\bonAdd\s*\(|addCvFile\s*\(/, `${rel} adds a CV outside the router`);
  }
  // The attached JD/company card's picker and drop go the same way.
  const zone = code("./AnalyzeFileDropZone.tsx");
  assert.match(zone, /planSingleSlot\(/, "a standalone zone (the /me import) still plans its own single slot");
});

test("replacing the JD by any path goes through the one JD-source door", () => {
  // challenge-r10 analyze-workspace/A: the file/text/slug trio was kept in step by hand
  // at six writers (a setJobDescriptionFile + setSelectedJdSlug(null) pair here, three in
  // the column), and the picker's own pick was the one that forgot. The rule now lives
  // in analyzeJdSource.ts; every writer dispatches into it.
  const intake = code("./useAnalyzeFileAccept.ts");
  const jdCommit = intake.slice(intake.indexOf("plan.jd"), intake.indexOf("plan.company"));
  assert.match(jdCommit, /dispatchJd\(\{ type: "attachFile", file: plan\.jd\.file \}\)/, "the router commits a JD file through the door");
  for (const rel of ["./useAnalyzeFileAccept.ts", "./AnalyzeFormOptionalColumns.tsx"]) {
    const src = code(rel);
    assert.doesNotMatch(src, /setSelectedJdSlug|setJobDescriptionFile|setJobDescriptionText/, `${rel} writes a JD atom outside the door`);
  }
  const hook = code("./useAnalyzeJdLibrary.ts");
  assert.doesNotMatch(hook, /setSelectedJdSlug|setJobDescriptionText/, "the library hook dispatches, it holds no JD atom");
  assert.match(hook, /type: "pickSaved"/);
  const form = code("./useAnalyzeForm.ts");
  assert.doesNotMatch(form, /useState<File \| null>\(\(\) => takeAnalyzeAttachments\(\)\.jobDescriptionFile\)/, "no separate JD file atom");
  assert.match(form, /jdSubmission\(jdSource\)/, "the submit sends the source's projection");
});

test("upload-constraints exports the paired client + server gates, no divergent duplicate", () => {
  const src = read("../../../_lib/upload-constraints.ts");
  assert.match(src, /export function acceptUpload/, "acceptUpload must be the exported client gate");
  // The server twin (idea-5b61d729): one shared MIME+size gate both upload
  // routes call, instead of each route re-implementing it inline.
  assert.match(src, /export function validateUploadServer/, "validateUploadServer must be the exported server gate");
  assert.doesNotMatch(src, /export function validateUpload\(/, "validateUpload must not be a second client gate");
});
