// "No JDs saved" is a claim about the recruiter's own data. The Analyze form used
// to make it from an empty array that could equally mean "still loading" or "the
// request failed" — the library fetch was unbounded and ended in `.catch(() => {})`.
// These tests pin the vocabulary that separates the three, the bound on the list,
// and the two source-level facts a pure test cannot see (the picker renders the
// failed branch with a retry; the hook no longer swallows a failure).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/features/tools/analyze/analyzeJdLibraryState.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  JD_LIBRARY_LIMIT,
  JD_LIBRARY_STATES,
  boundJdLibrary,
  isJdLibraryState,
  readJdLibraryPayload,
} from "./analyzeJdLibraryState.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("the library states are a closed vocabulary with a runtime guard", () => {
  assert.deepEqual([...JD_LIBRARY_STATES], ["loading", "ready", "failed"]);
  for (const state of JD_LIBRARY_STATES) assert.ok(isJdLibraryState(state));
  assert.ok(!isJdLibraryState("empty"), "'empty' is not a load state — it is a count");
  assert.ok(!isJdLibraryState(undefined));
});

test("a genuine empty library is ready, not failed", () => {
  assert.deepEqual(readJdLibraryPayload({ jds: [] }), { state: "ready", jds: [] });
});

test("a populated payload is ready and keeps its rows in order", () => {
  const rows = [{ slug: "a" }, { slug: "b" }];
  const result = readJdLibraryPayload<{ slug: string }>({ jds: rows });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.jds.map((r) => r.slug), ["a", "b"]);
});

test("a non-list payload is a FAILURE, never an empty library", () => {
  // The list route answers a store fault with { error, code } — reading that as
  // "you have no saved JDs" is the exact lie this direction removes.
  for (const payload of [null, undefined, {}, { error: "boom", code: "JD_LIST_FAILED" }, { jds: null }]) {
    const result = readJdLibraryPayload(payload);
    assert.equal(result.state, "failed", `payload ${JSON.stringify(payload)} must read as failed`);
    assert.deepEqual(result.jds, []);
  }
});

test("the library is bounded by a stated limit", () => {
  const many = Array.from({ length: JD_LIBRARY_LIMIT + 25 }, (_, i) => ({ slug: `jd-${i}` }));
  assert.equal(boundJdLibrary(many).length, JD_LIBRARY_LIMIT);
  assert.equal(readJdLibraryPayload<{ slug: string }>({ jds: many }).jds.length, JD_LIBRARY_LIMIT);
  // The bound matches the route's own listJds(200) cap — if one moves, so must
  // the other, and this is where that pairing is written down.
  assert.equal(JD_LIBRARY_LIMIT, 200);
  assert.match(read("../../../api/jds/route.ts"), /listJds\(200,/);
});

test("boundJdLibrary copies rather than aliasing the payload's array", () => {
  const rows = [{ slug: "a" }];
  const bounded = boundJdLibrary(rows);
  bounded.push({ slug: "b" });
  assert.equal(rows.length, 1);
});

test("the hook fetches with the stated limit and reports failure instead of swallowing it", () => {
  const hook = read("./useAnalyzeJdLibrary.ts");
  assert.match(hook, /\/api\/jds\?limit=\$\{JD_LIBRARY_LIMIT\}/, "the list fetch carries the stated limit");
  assert.match(hook, /setJdLibraryState\("failed"\)/, "a failed load is reported");
  // …and never again by an empty catch. Prose mentioning the old shape is fine;
  // an actual code line is not, so the source is stripped of comments first (the
  // house rule bans an empty catch body outright).
  const code = hook.replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/\.catch\(\(\) => \{\s*\}\)/.test(code),
    "the failure-swallowing empty catch must be gone"
  );
  assert.match(hook, /jdLibraryState,/, "the state is returned to the surface");
  assert.match(hook, /reloadJdLibrary/, "…along with the retry the picker offers");
});

test("the picker renders the failed state with a retry, resolved from a code", () => {
  const picker = read("./AnalyzeSavedJdPicker.tsx");
  assert.match(picker, /libraryState === "failed"/);
  assert.match(picker, /onRetryLibrary/, "the failed branch offers a retry");
  assert.match(
    picker,
    /errorMessage\(\{ code: "JD_LIST_FAILED" \}, t\("jdLibraryFailed"\)\)/,
    "the reason resolves through useErrorMessage, not a server string"
  );
  assert.match(picker, /libraryState === "loading"/, "…and loading is distinguished from empty");
});
