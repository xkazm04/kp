// Source-level guards over the two profile-editor decisions that are pure control flow
// inside a React hook — untestable by import here (there is no renderer in the node:test
// harness) but each one a shipped bug the moment it drifts:
//
//   1. useProfileEditorSubmit's POST-vs-PUT. Every POST INSERTS. The editor deliberately
//      STAYS OPEN after a save so the recruiter can work through the completeness gaps,
//      and `mode` stays "create" for that whole session — so the loop the UI invites
//      once filed one extra half-finished profile per click. The rule that fixed it
//      (remember the created id; PUT from the second save on) has no test of its own.
//   2. useProfileTabDeepLinks' param precedence. `?fromAnalysis=` must be read and
//      RETURNED FROM before `?edit=`, or a build-from-analysis link that also carries a
//      leftover edit param opens the wrong profile. The mount-only effect is a
//      one-time intent; both branches clear their params up front.
//
// Also pinned: the version guard rides the PUT only (a POST has nothing to race).
//
// Every assertion is proved non-vacuous against a MUTATED copy of the same source, so a
// guard can never pass because its pattern stopped matching anything at all.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  // Line endings normalised: this checkout carries CRLF (core.autocrlf=true) and a
  // multi-line marker would never match otherwise.
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const submit = read("./useProfileEditorSubmit.ts");
const deepLinks = read("./useProfileTabDeepLinks.ts");

/** Assert `pattern` matches `src`, and that it does NOT match `src` with `mutate`
 *  applied — so the guard is proved to be watching something real. */
function pins(src: string, pattern: RegExp, mutate: (s: string) => string, why: string): void {
  assert.match(src, pattern, why);
  assert.doesNotMatch(mutate(src), pattern, `non-vacuity: the guard for "${why}" must fail on a broken source`);
}

test("a create's SECOND save updates the row its FIRST save wrote, never inserting again", () => {
  // The remembered id exists…
  pins(
    submit,
    /setCreatedId\(built\.saved\.id\)/,
    (s) => s.replace("setCreatedId(built.saved.id)", "/* dropped */"),
    "a persisted create pins the row id it just wrote"
  );
  // …and is what an edit-less session targets.
  pins(
    submit,
    /const targetId = mode === "edit" \? editingId : createdId;/,
    (s) => s.replace(": createdId;", ": null;"),
    "the save target is the edit's id, else the id the first create returned"
  );
  // A PUT is chosen from that target, and ONLY on a real save — a persist:false preview
  // must stay a POST, because it writes nothing and must never claim a row.
  pins(
    submit,
    /const isEdit = Boolean\(persist && targetId\);/,
    (s) => s.replace("Boolean(persist && targetId)", "Boolean(targetId)"),
    "PUT requires both a persist and a target row"
  );
  pins(
    submit,
    /method: isEdit \? "PUT" : "POST"/,
    (s) => s.replace('isEdit ? "PUT" : "POST"', '"POST"'),
    "the verb follows that decision"
  );
});

test("the version guard rides the PUT body only", () => {
  // The PUT names the row AND the version it may overwrite…
  pins(
    submit,
    /\{ id: targetId, profile, signals, expectedUpdatedAt, \.\.\.lineage \}/,
    (s) => s.replace(", expectedUpdatedAt,", ","),
    "an update carries expectedUpdatedAt so a stale save is refused"
  );
  // …while the POST body does not: an INSERT has no prior version to contend with, and
  // sending one would be a precondition against a row that does not exist yet.
  assert.match(
    submit,
    /\{ profile, signals, persist, \.\.\.lineage \}/,
    "a create posts profile/signals/persist without a version guard"
  );
  // The refusal is read from the machine code, never from the server's English.
  pins(
    submit,
    /r\.status === 409 && \(payload as \{ code\?: string \}\)\.code === "PROFILE_STALE"/,
    (s) => s.replace('=== "PROFILE_STALE"', '=== "SOMETHING_ELSE"'),
    "the stale branch is keyed on the 409 + PROFILE_STALE code"
  );
});

test("the deep-link effect reads ?fromAnalysis BEFORE ?edit, and returns from it", () => {
  const fromAnalysisAt = deepLinks.indexOf('params.get("fromAnalysis")');
  const editAt = deepLinks.indexOf('params.get("edit")');
  assert.ok(fromAnalysisAt > 0 && editAt > 0, "both intents must still be read in the mount effect");
  assert.ok(
    fromAnalysisAt < editAt,
    "?fromAnalysis is the more specific intent and must be resolved first — an ?edit left in the URL must not win"
  );
  // The precedence is a RETURN, not a fallthrough: without it both openers would fire
  // and the second would win the race to setEditor.
  const between = deepLinks.slice(fromAnalysisAt, editAt);
  assert.match(between, /\n\s+return;\n/, "the fromAnalysis branch must return rather than fall through to the edit branch");
  // Inside that branch, a rebuild (which PUTs an existing row) goes through the
  // divergence check; a first build hydrates straight away.
  pins(
    between,
    /if \(rebuild\) void openRebuild\(fromAnalysis, rebuild\);\s*\n\s*else void openFromAnalysis\(fromAnalysis, null\);/,
    (s) => s.replace("if (rebuild) void openRebuild", "if (false) void openRebuild"),
    "a rebuild takes the divergence-checked opener, a first build does not"
  );
});

test("every opener of an EXISTING row carries the version it read", () => {
  // openEditor and openRebuild both GET /api/profile?id= — the response that carries
  // `updatedAt` — so neither may open an editor without threading it through.
  pins(
    deepLinks,
    /initialUpdatedAt: \(p\.updatedAt as string \| null\) \?\? null,/,
    (s) => s.replace("initialUpdatedAt: (p.updatedAt as string | null) ?? null,", ""),
    "the plain edit opener threads the row version into the editor"
  );
  pins(
    deepLinks,
    /initialUpdatedAt: rebuildProfileId \? rebuildUpdatedAt \?\? null : null,/,
    (s) => s.replace("rebuildProfileId ? rebuildUpdatedAt ?? null : null", "null"),
    "a rebuild threads the version too; a first build (no row) has none"
  );
});
