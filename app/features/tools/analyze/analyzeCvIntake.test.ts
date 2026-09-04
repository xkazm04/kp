// The CV-variant intake and the form's draft persistence — the two pieces of the
// Analyze intake that had no coverage at all (a grep for useAnalyzeCvFiles /
// useAnalyzeForm across the suite returned one hit, and it was about cancel
// routing).
//
// Both are exercised over REAL objects: actual `File`s through the actual
// content-hash dedupe (crypto.subtle is available in Node), and an actual JSON
// round-trip for the draft. The dedupe rule matters because it is shared with the
// server intake — a client that disagrees about what a duplicate is either loses
// a distinct CV or pays to analyse a clone against itself.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeCvIntake.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CV_INTAKE_OUTCOMES,
  admitCvFile,
  fitsWithinCap,
  isCvIntakeOutcome,
} from "./analyzeCvIntake.ts";
import {
  ANALYZE_DRAFT_KEY,
  parseAnalyzeDraft,
  restoreDraftValue,
  serializeAnalyzeDraft,
} from "./analyzeDraft.ts";

const CAP = 3;

/** A real File with the given bytes — content is what identity is computed from. */
function cv(name: string, body: string): File {
  return new File([body], name, { type: "text/plain" });
}

// --- intake -----------------------------------------------------------------

test("the intake outcomes are a closed vocabulary with a runtime guard", () => {
  assert.deepEqual([...CV_INTAKE_OUTCOMES], ["added", "duplicate", "capped"]);
  for (const outcome of CV_INTAKE_OUTCOMES) assert.ok(isCvIntakeOutcome(outcome));
  assert.ok(!isCvIntakeOutcome("rejected"));
});

test("a first CV is added", async () => {
  const result = await admitCvFile([], cv("ada.pdf", "ADA RESUME"), CAP);
  assert.equal(result.outcome, "added");
  assert.deepEqual(result.files.map((f) => f.name), ["ada.pdf"]);
});

test("dedupe is by CONTENT, so a renamed clone is refused", async () => {
  const first = cv("ada.pdf", "ADA RESUME");
  const renamed = cv("ada-final-v2.pdf", "ADA RESUME");
  const result = await admitCvFile([first], renamed, CAP);
  assert.equal(result.outcome, "duplicate");
  assert.deepEqual(result.files.map((f) => f.name), ["ada.pdf"], "the existing list is untouched");
});

test("two different CVs sharing a name AND a byte length are both kept", async () => {
  // The rule this replaced was `name === name && size === size`, which merged
  // exactly this pair — a distinct variant silently lost. Same name, same length,
  // different bytes.
  const first = cv("cv.pdf", "AAAAAAAA");
  const other = cv("cv.pdf", "BBBBBBBB");
  assert.equal(first.size, other.size, "the fixture must actually collide on size");
  const result = await admitCvFile([first], other, CAP);
  assert.equal(result.outcome, "added");
  assert.equal(result.files.length, 2);
});

test("the cap refuses the file that would exceed it", async () => {
  const full = [cv("a.pdf", "A"), cv("b.pdf", "B"), cv("c.pdf", "C")];
  const result = await admitCvFile(full, cv("d.pdf", "D"), CAP);
  assert.equal(result.outcome, "capped");
  assert.equal(result.files.length, CAP);
});

test("a serialized queue of the same file appends it exactly once", async () => {
  // What the hook's promise chain buys: each add sees the previous one's append.
  // Without it both adds dedupe against the same empty snapshot and both append.
  const same = () => cv("ada.pdf", "ADA RESUME");
  let files: File[] = [];
  for (const file of [same(), same(), same()]) {
    const result = await admitCvFile(files, file, CAP);
    files = result.files;
  }
  assert.equal(files.length, 1, "three drops of one CV are one variant");
});

test("a hash failure ADMITS the file — the server is the authoritative dedupe", async () => {
  // crypto.subtle needs a secure context. Dropping a recruiter's upload because
  // we could not hash it is far worse than analysing one clone.
  const result = await admitCvFile([cv("a.pdf", "A")], cv("a.pdf", "A"), CAP, async () => {
    throw new Error("crypto.subtle is unavailable");
  });
  assert.equal(result.outcome, "added");
});

test("admitCvFile never mutates the list it was handed", async () => {
  const current = [cv("a.pdf", "A")];
  const result = await admitCvFile(current, cv("b.pdf", "B"), CAP);
  assert.equal(current.length, 1);
  assert.notEqual(result.files, current);
});

test("the post-await cap re-check catches a list that filled during the hash", () => {
  // admitCvFile reads a snapshot taken BEFORE the await; a sibling add can take
  // the last slot in that window, and the pre-check alone would overflow by one.
  assert.ok(fitsWithinCap([cv("a.pdf", "A")], CAP));
  assert.ok(!fitsWithinCap([cv("a.pdf", "A"), cv("b.pdf", "B"), cv("c.pdf", "C")], CAP));
});

test("the hook consumes the shared verdict and still re-checks the live ref", () => {
  const hook = readFileSync(fileURLToPath(new URL("./useAnalyzeCvFiles.ts", import.meta.url)), "utf8");
  assert.match(hook, /admitCvFile\(cvFilesRef\.current, file, MAX_CV_VARIANTS\)/);
  assert.match(hook, /fitsWithinCap\(cvFilesRef\.current, MAX_CV_VARIANTS\)/, "re-checked against the LIVE ref");
  assert.match(hook, /addCvSeqRef\.current\.then/, "intake stays serialized");
});

// --- draft persistence ------------------------------------------------------

test("a draft round-trips through storage", () => {
  const serialized = serializeAnalyzeDraft({ jd: "Backend engineer", company: "Acme", github: "octocat" });
  assert.ok(serialized);
  assert.deepEqual(parseAnalyzeDraft(serialized), {
    jd: "Backend engineer",
    company: "Acme",
    github: "octocat",
  });
});

test("an all-empty draft serializes to null, i.e. REMOVE the key", () => {
  assert.equal(serializeAnalyzeDraft({ jd: "", company: "", github: "" }), null);
  assert.equal(serializeAnalyzeDraft({}), null);
  // …so a reset leaves no residue that a later mount would restore.
  assert.equal(parseAnalyzeDraft(JSON.stringify({ jd: "", company: "", github: "" })), null);
});

test("a partial draft keeps only the fields that carry text", () => {
  const serialized = serializeAnalyzeDraft({ jd: "Backend engineer", company: "", github: "" });
  assert.deepEqual(JSON.parse(serialized!), { jd: "Backend engineer" });
});

test("junk under the key is refused, never pushed into a controlled input", () => {
  // sessionStorage is the one input nobody here controls: another tab, an older
  // build, or devtools can leave anything at all. A non-string field reaching a
  // controlled <textarea> is the white-screen shape the ?jd= deep link already
  // produced once.
  for (const raw of [null, "", "not json", "[1,2,3]", '"a string"', "null", "42"]) {
    assert.equal(parseAnalyzeDraft(raw), null, `refused: ${JSON.stringify(raw)}`);
  }
  assert.equal(parseAnalyzeDraft(JSON.stringify({ jd: { body: "nope" } })), null);
  assert.deepEqual(
    parseAnalyzeDraft(JSON.stringify({ jd: "keep me", company: 42, github: ["x"] })),
    { jd: "keep me" },
    "a corrupted field is dropped, not the whole draft — the JD survives"
  );
});

test("the restore only fills a field that is still empty", () => {
  // A saved-JD pick or a prop-seeded value from THIS mount is fresher than the
  // draft and must win, or picking a JD then switching tabs would silently
  // restore the older typed text over it.
  assert.equal(restoreDraftValue("picked from library", "stale draft"), "picked from library");
  assert.equal(restoreDraftValue("", "stale draft"), "stale draft");
  assert.equal(restoreDraftValue("", undefined), "");
});

test("the form uses the shared codec and the documented key", () => {
  assert.equal(ANALYZE_DRAFT_KEY, "kp.analyzeDraft");
  const form = readFileSync(fileURLToPath(new URL("./useAnalyzeForm.ts", import.meta.url)), "utf8");
  assert.match(form, /parseAnalyzeDraft\(sessionStorage\.getItem\(ANALYZE_DRAFT_KEY\)\)/);
  assert.match(form, /serializeAnalyzeDraft\(\{/);
  assert.match(form, /payload === null\) sessionStorage\.removeItem\(ANALYZE_DRAFT_KEY\)/);
  assert.match(form, /restoreDraftValue\(prev, jd\)/);
  // The storage catches say WHY they drop (the house rule bans a bare catch {}).
  assert.ok(!/catch \{\s*\/\* ignore \*\/\s*\}/.test(form), "a catch that says 'ignore' says nothing");
});
