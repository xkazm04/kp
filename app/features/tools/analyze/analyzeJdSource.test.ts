// Pins the Analyze JD column's one source of truth (challenge-r10 analyze-workspace/A).
//
// The column used to be three independent atoms (file, text, saved-JD slug) kept in
// step by hand at six call sites. These cases pin the rule they were meant to hold:
// one active source, and a slug only when its body is exactly what gets sent.
//
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeJdSource.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JD_NONE,
  jdLoadFailed,
  jdStatus,
  jdSubmission,
  linkedSlug,
  nextJdSource,
  reconcileRestoredLink,
  type JdAction,
  type JdSource,
} from "./analyzeJdSource.ts";

const jdFile = (name = "role.pdf") => new File(["%PDF-1.4 role"], name, { type: "application/pdf" });
const BODY = "We are hiring a backend engineer who owns the payments ledger.";

function run(source: JdSource, ...actions: JdAction[]): JdSource {
  return actions.reduce(nextJdSource, source);
}

function readySaved(slug = "backend-dev", body = BODY): JdSource {
  return run(JD_NONE, { type: "pickSaved", slug }, { type: "bodyLoaded", slug, body });
}

// ── Case 1: a pick replaces an attached JD file ──────────────────────────────
test("pickSaved over an attached JD file drops the file; the loaded body is what is sent", () => {
  const withFile = run(JD_NONE, { type: "attachFile", file: jdFile() });
  assert.equal(withFile.kind, "file");
  const picked = nextJdSource(withFile, { type: "pickSaved", slug: "backend-dev" });
  assert.equal(picked.kind, "saved");
  assert.equal(jdSubmission(picked).file, null, "no file survives the pick");
  assert.equal(jdSubmission(picked).jdSlug, null, "no slug rides along before the body lands");
  const loaded = nextJdSource(picked, { type: "bodyLoaded", slug: "backend-dev", body: BODY });
  assert.deepEqual(jdSubmission(loaded), { file: null, text: BODY, jdSlug: "backend-dev" });
});

// ── Case 2: a file replaces a pick or typed text; no state projects file+slug/text ──
test("attachFile on a saved or typed source becomes a file source with no text and no slug", () => {
  const file = jdFile();
  for (const from of [readySaved(), run(JD_NONE, { type: "edit", text: "typed JD" })]) {
    const next = nextJdSource(from, { type: "attachFile", file });
    assert.equal(next.kind, "file");
    assert.deepEqual(jdSubmission(next), { file, text: "", jdSlug: null });
  }
});

test("no reachable source projects file+slug, file+text, or a slug without its body (every sequence <= 4)", () => {
  const file = jdFile();
  const alphabet: JdAction[] = [
    { type: "pickSaved", slug: "a" },
    { type: "pickSaved", slug: "b" },
    { type: "bodyLoaded", slug: "a", body: "Body A" },
    { type: "bodyLoaded", slug: "b", body: "Body B" },
    { type: "bodyLoaded", slug: "a", body: "   " },
    { type: "bodyFailed", slug: "a" },
    { type: "edit", text: "typed" },
    { type: "edit", text: "" },
    { type: "revert" },
    { type: "unlink" },
    { type: "attachFile", file },
    { type: "removeFile" },
    { type: "clear" },
  ];
  let checked = 0;
  const walk = (source: JdSource, depth: number, path: string[]) => {
    const sub = jdSubmission(source);
    const where = path.join(" > ") || "(none)";
    assert.ok(!(sub.file && sub.jdSlug), `file+slug after ${where}`);
    assert.ok(!(sub.file && sub.text), `file+text after ${where}`);
    if (sub.jdSlug) assert.ok(sub.text.trim().length > 0, `slug with no body after ${where}`);
    checked++;
    if (depth === 4) return;
    for (const action of alphabet) walk(nextJdSource(source, action), depth + 1, [...path, action.type]);
  };
  walk(JD_NONE, 0, []);
  assert.ok(checked > 30_000, `walked ${checked} states`);
});

// ── Case 3: an edit keeps the link and says so; revert and unlink are explicit ──
test("editing a ready saved JD keeps the slug and marks it edited; revert and unlink undo it", () => {
  const ready = readySaved();
  const edited = nextJdSource(ready, { type: "edit", text: `${BODY} Typo fixed.` });
  assert.equal(edited.kind, "saved");
  assert.equal(linkedSlug(edited), "backend-dev");
  assert.equal(edited.kind === "saved" && edited.edited, true);
  assert.equal(jdSubmission(edited).jdSlug, "backend-dev", "the role still grounds the run");

  const same = nextJdSource(edited, { type: "edit", text: BODY });
  assert.equal(same.kind === "saved" && same.edited, false, "typing back to the baseline is not an edit");

  const reverted = nextJdSource(edited, { type: "revert" });
  assert.equal(reverted.kind === "saved" && reverted.text, BODY);
  assert.equal(reverted.kind === "saved" && reverted.edited, false);

  const unlinked = nextJdSource(edited, { type: "unlink" });
  assert.equal(unlinked.kind, "typed");
  assert.deepEqual(jdSubmission(unlinked), { file: null, text: `${BODY} Typo fixed.`, jdSlug: null });
});

test("clearing a saved JD's text unlinks it rather than sending the slug with no body", () => {
  const cleared = nextJdSource(readySaved(), { type: "edit", text: "   " });
  assert.equal(cleared.kind, "none");
  assert.deepEqual(jdSubmission(cleared), { file: null, text: "", jdSlug: null });
});

test("a stale body for an older pick, or one landing after the recruiter typed, is ignored", () => {
  const newer = run(JD_NONE, { type: "pickSaved", slug: "a" }, { type: "pickSaved", slug: "b" });
  const stale = nextJdSource(newer, { type: "bodyLoaded", slug: "a", body: "Body A" });
  assert.equal(stale, newer, "A's late body cannot land under B's slug");
  const typedOver = run(JD_NONE, { type: "pickSaved", slug: "a" }, { type: "edit", text: "mine" });
  assert.equal(typedOver.kind, "typed", "typing during the load takes the column");
  const late = nextJdSource(typedOver, { type: "bodyLoaded", slug: "a", body: "Body A" });
  assert.deepEqual(jdSubmission(late), { file: null, text: "mine", jdSlug: null });
});

// ── Case 4: a failed body never rides a slug ────────────────────────────────
test("bodyFailed (404, network, non-string or blank body) sends no slug and reports the failure", () => {
  const prior = run(JD_NONE, { type: "edit", text: "what I had typed" });
  const failures: JdAction[] = [
    { type: "bodyFailed", slug: "backend-dev" },
    { type: "bodyLoaded", slug: "backend-dev", body: { error: "not found" } },
    { type: "bodyLoaded", slug: "backend-dev", body: 42 },
    { type: "bodyLoaded", slug: "backend-dev", body: "  " },
  ];
  for (const failure of failures) {
    const failed = run(prior, { type: "pickSaved", slug: "backend-dev" }, failure);
    assert.equal(jdLoadFailed(failed), true, JSON.stringify(failure));
    assert.equal(jdSubmission(failed).jdSlug, null);
    assert.equal(linkedSlug(failed), null, "the picker shows no selection");
    assert.equal(jdSubmission(failed).text, "what I had typed", "the failed pick kept the prior text");
    const corrected = nextJdSource(failed, { type: "edit", text: "retyped" });
    assert.equal(jdLoadFailed(corrected), false, "a corrective edit dismisses the failure");
  }
});

// ── Case 6: a restored link is dropped only on proof ─────────────────────────
test("reconcileRestoredLink drops a restored link only when a complete, loaded library lacks it", () => {
  const restored: JdSource = {
    kind: "saved",
    slug: "gone",
    text: BODY,
    baseline: BODY,
    state: "ready",
    edited: false,
    restored: true,
  };
  const others = [{ slug: "backend-dev", title: "Backend developer" }];
  const proven = reconcileRestoredLink(restored, { state: "ready", truncated: false, jds: others });
  assert.equal(proven.source.kind, "typed");
  assert.equal(proven.notice, "linkGone");
  assert.deepEqual(jdSubmission(proven.source), { file: null, text: BODY, jdSlug: null });

  for (const library of [
    { state: "ready" as const, truncated: true, jds: others },
    { state: "loading" as const, truncated: false, jds: [] },
    { state: "failed" as const, truncated: false, jds: [] },
  ]) {
    const kept = reconcileRestoredLink(restored, library);
    assert.equal(kept.source.kind, "saved", JSON.stringify(library));
    assert.equal(linkedSlug(kept.source), "gone");
    assert.equal(kept.notice, null);
  }

  const found = reconcileRestoredLink(restored, {
    state: "ready",
    truncated: false,
    jds: [...others, { slug: "gone", title: "Still here" }],
  });
  assert.equal(linkedSlug(found.source), "gone");
  assert.equal(found.notice, null);
  assert.equal(found.source.kind === "saved" && found.source.restored, false, "verified once, then settled");

  const picked = readySaved("backend-dev");
  const unrelated = reconcileRestoredLink(picked, { state: "ready", truncated: false, jds: [] });
  assert.equal(unrelated.source, picked, "a pick made this mount is not re-litigated");
});

// ── Case 7: the column says whether the run is role-linked ───────────────────
test("jdStatus names the linked role, the edit, the file, or the character count", () => {
  const jds = [{ slug: "backend-dev", title: "Backend developer" }];
  assert.deepEqual(jdStatus(readySaved(), jds), { tone: "attached", key: "jdLinkedTo", title: "Backend developer" });
  const edited = nextJdSource(readySaved(), { type: "edit", text: "changed" });
  assert.deepEqual(jdStatus(edited, jds), { tone: "attached", key: "jdEditedFrom", title: "Backend developer" });
  assert.deepEqual(jdStatus(readySaved(), []), { tone: "attached", key: "jdLinkedTo", title: "backend-dev" }, "slug when the title is not listed");
  assert.deepEqual(jdStatus(run(JD_NONE, { type: "attachFile", file: jdFile("jd.pdf") }), jds), {
    tone: "attached",
    key: "file",
    name: "jd.pdf",
  });
  assert.deepEqual(jdStatus(run(JD_NONE, { type: "edit", text: "  twelve chars  " }), jds), {
    tone: "attached",
    key: "charsCount",
    count: 12,
  });
  assert.deepEqual(jdStatus(run(JD_NONE, { type: "pickSaved", slug: "backend-dev" }), jds), { tone: "attached", key: "loadingJd" });
  assert.deepEqual(jdStatus(JD_NONE, jds), { tone: "optional", key: "optional" });
});

test("removeFile and clear return to none; removeFile leaves a non-file source alone", () => {
  assert.equal(run(JD_NONE, { type: "attachFile", file: jdFile() }, { type: "removeFile" }).kind, "none");
  const ready = readySaved();
  assert.equal(nextJdSource(ready, { type: "removeFile" }), ready);
  assert.equal(nextJdSource(ready, { type: "clear" }).kind, "none");
});
