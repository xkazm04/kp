// Pins the roster's counted batch refresh (challenge-r05 profile-roster-matrix/B).
//
// A re-analysis of a CV marks its profile "Newer CV". For a profile nobody edited, the
// per-row Rebuild is ceremony: the editor opens prefilled with the newer analysis and
// waits for a Save. The batch does that Save for every UNEDITED stale profile in view,
// in one counted pass — and NEVER writes a profile carrying a recruiter's edits: those
// are skipped and handed over as a review queue (the per-profile merge dialog). The
// registry rule it makes real: a bulk rebuild skips human-edited records by default,
// reports the count skipped, and never runs over a population it has not first counted.
//
// The batch rides the editor's own PUT (same body, same lost-update check, same lineage
// re-stamp, same per-IP rate-limit bucket), so the cases below pin: the plan, the
// request's byte-equality with the editor's save, and a truthful outcome per row for
// 200 / 409 / 429 / 404 / abort. (Case 1 — the store's `edited` + `updatedAt` on each
// staleness entry — is pinned in app/_lib/db/profiles-lineage.test.ts and the
// single-query oracle in profiles-staleness-equivalence.test.ts.)
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import type { StaleMap } from "./ProfileRosterTypes.ts";
import { formStateFrom } from "./useProfileEditorFields.ts";
import { buildProfilePayload } from "./profileEditorPayload.ts";
import { planBulkRefresh, refreshRequest, runBulkRefresh, type RefreshEntry } from "./profileBulkRefresh.ts";

const V2: ProfilePayload = {
  displayName: "Jana Novak",
  roleFamily: "engineering",
  educationLevel: "master",
  languages: ["Czech", "English"],
  location: "Praha",
  availability: "from July",
  aspirations: ["platform work"],
  yearsExperience: 6,
  seniority: "senior",
  skillClaims: [
    { skill: "Go", level: "strong", provenance: "cv" },
    { skill: "SQL", level: "working", provenance: "cv" },
  ],
  evidence: [{ kind: "project", title: "Ledger", text: "Built the ledger", skills: ["Go"], link: "" }],
};

const entry = (id: string, over: Partial<RefreshEntry> = {}): RefreshEntry => ({
  id,
  newerSlug: `${id}-newer`,
  newerAnalyzedAt: "2026-09-02T00:00:00.000Z",
  edited: false,
  updatedAt: `2026-09-01T00:00:00.000Z#${id}`,
  ...over,
});

type Call = { url: string; method: string; body: unknown; signal: AbortSignal | undefined };

// A fake fetch that answers from a per-call script and records every call.
function fakeFetch(
  answer: (url: string, method: string, body: unknown) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>
) {
  const calls: Call[] = [];
  const fn = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: input, method, body, signal: init?.signal ?? undefined });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const a = await answer(input, method, body);
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}

const analysisOk = () => ({ status: 200, body: { analysis: { v2Profile: V2 } } });
const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");

test("case 2: planBulkRefresh counts only what is in view — clean vs edited, never the current or the filtered-out", () => {
  const inView = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const stale: StaleMap = {
    a: entry("a"),
    b: entry("b"),
    c: entry("c"),
    d: entry("d", { edited: true }),
    // "e" is current (no entry); "f" is stale but filtered OUT of view.
    f: entry("f"),
  };
  const plan = planBulkRefresh(inView, stale);
  assert.deepEqual(plan.clean.map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(plan.edited.map((r) => r.id), ["d"]);
  assert.equal(plan.clean[0].newerSlug, "a-newer", "each planned row carries its rebuild target");
});

test("case 2b: an entry that cannot PROVE it is unedited (no flag, or no version to re-assert) goes to review, never to the batch", () => {
  const stale: StaleMap = {
    a: { newerSlug: "a2", newerAnalyzedAt: "2026-09-02" },
    b: entry("b", { updatedAt: null }),
  };
  const plan = planBulkRefresh([{ id: "a" }, { id: "b" }], stale);
  assert.deepEqual(plan.clean, []);
  assert.deepEqual(plan.edited.map((r) => r.id), ["a", "b"]);
});

test("case 3: refreshRequest is byte-equal to the PUT the editor sends when a rebuild is opened and saved unchanged", () => {
  const e = entry("p1");
  const req = refreshRequest(e, V2);
  // The editor's own construction (useProfileEditorSubmit.build over the form state
  // openFromAnalysis seeds: formStateFrom(v2), no archetype override).
  const f = formStateFrom(V2);
  const editorProfile = buildProfilePayload(f);
  const editorSignals = {
    selfDeclared: f.choice,
    isEnrolled: f.isEnrolled,
    expectedGraduation: f.expectedGraduation || undefined,
    wantsDomainChange: f.wantsDomainChange,
    hasSubstantialExperience: f.hasSubstantialExperience,
  };
  const lineage = { sourceAnalysisSlug: e.newerSlug };
  const editorBody = { id: e.id, profile: editorProfile, signals: editorSignals, expectedUpdatedAt: e.updatedAt, ...lineage };
  assert.deepEqual(req.signals, editorSignals, "signals come from the editor's form state, not literals");
  assert.deepEqual(req, editorBody);
  assert.equal(JSON.stringify(req), JSON.stringify(editorBody), "byte-equal on the wire, key order included");
  assert.equal(req.expectedUpdatedAt, e.updatedAt, "the batch re-asserts the version it counted");
  assert.equal(req.sourceAnalysisSlug, e.newerSlug, "the PUT re-stamps lineage, so the staleness clears");
});

test("case 3b: the editor still builds its PUT the way refreshRequest mirrors it (source pin — drift turns this red)", () => {
  const src = readFileSync(new URL("./useProfileEditorSubmit.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /const profile = buildProfilePayload\(fields\);/);
  assert.match(
    src,
    /const signals = \{\n\s*selfDeclared: fields\.choice,\n\s*isEnrolled: fields\.isEnrolled,\n\s*expectedGraduation: fields\.expectedGraduation \|\| undefined,\n\s*wantsDomainChange: fields\.wantsDomainChange,\n\s*hasSubstantialExperience: fields\.hasSubstantialExperience,\n\s*\};/
  );
  assert.match(src, /\{ id: targetId, profile, signals, expectedUpdatedAt, \.\.\.lineage \}/);
  assert.match(src, /\{ sourceAnalysisSlug \}/);
  const deep = readFileSync(new URL("./useProfileTabDeepLinks.ts", import.meta.url), "utf8");
  assert.match(deep, /initialPayload: v2,/, "an unedited rebuild seeds the editor with the newer v2Profile as-is");
});

test("case 4: three clean rows, every answer 200 -> refreshed x3, exactly three PUTs, each with its own version and target", async () => {
  const rows = [entry("a"), entry("b"), entry("c")];
  const { fn, calls } = fakeFetch((url, method) =>
    method === "PUT" ? { status: 200, body: { saved: { id: "x" } } } : analysisOk()
  );
  const result = await runBulkRefresh({ rows, fetch: fn });
  assert.deepEqual(result.outcomes.map((o) => [o.id, o.outcome]), [
    ["a", "refreshed"],
    ["b", "refreshed"],
    ["c", "refreshed"],
  ]);
  const p = puts(calls);
  assert.equal(p.length, 3);
  for (const [i, r] of rows.entries()) {
    assert.equal(p[i].url, "/api/profile");
    const body = p[i].body as { id: string; expectedUpdatedAt: string; sourceAnalysisSlug: string };
    assert.equal(body.id, r.id);
    assert.equal(body.expectedUpdatedAt, r.updatedAt);
    assert.equal(body.sourceAnalysisSlug, r.newerSlug);
  }
  assert.deepEqual(
    calls.filter((c) => c.method === "GET").map((c) => c.url),
    ["/api/analyses/a-newer", "/api/analyses/b-newer", "/api/analyses/c-newer"]
  );
});

test("case 5: a 409 PROFILE_STALE on row 2 -> changedSince, and the run continues past the lost race", async () => {
  let n = 0;
  const { fn, calls } = fakeFetch((url, method) => {
    if (method !== "PUT") return analysisOk();
    n += 1;
    return n === 2 ? { status: 409, body: { error: "stale", code: "PROFILE_STALE" } } : { status: 200, body: {} };
  });
  const result = await runBulkRefresh({ rows: [entry("a"), entry("b"), entry("c")], fetch: fn });
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["refreshed", "changedSince", "refreshed"]);
  assert.equal(puts(calls).length, 3);
});

test("case 6: a 429 on row 2 -> throttled, row 3 notAttempted, and nothing is fetched after the 429", async () => {
  let n = 0;
  const { fn, calls } = fakeFetch((url, method) => {
    if (method !== "PUT") return analysisOk();
    n += 1;
    return n === 2 ? { status: 429, body: { error: "slow down", code: "TOO_MANY_REQUESTS" } } : { status: 200, body: {} };
  });
  const result = await runBulkRefresh({ rows: [entry("a"), entry("b"), entry("c")], fetch: fn });
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["refreshed", "throttled", "notAttempted"]);
  const last = calls[calls.length - 1];
  assert.equal(last.method, "PUT", "the 429 answer is the last call made");
  assert.equal((last.body as { id: string }).id, "b");
  assert.equal(calls.length, 4, "GET a, PUT a, GET b, PUT b — and then the run stops");
});

test("case 6b: a 429 on the analysis READ also stops the run honestly", async () => {
  const { fn, calls } = fakeFetch((url, method) => (method === "GET" && url.includes("b-newer") ? { status: 429, body: {} } : method === "PUT" ? { status: 200, body: {} } : analysisOk()));
  const result = await runBulkRefresh({ rows: [entry("a"), entry("b"), entry("c")], fetch: fn });
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["refreshed", "throttled", "notAttempted"]);
  assert.equal(calls.length, 3);
});

test("case 7: a 404 analysis, or one with no v2Profile -> failed/noNewerProfile and NO PUT for that row", async () => {
  const { fn, calls } = fakeFetch((url, method) => {
    if (method === "PUT") return { status: 200, body: {} };
    if (url.includes("a-newer")) return { status: 404, body: { error: "not found" } };
    if (url.includes("b-newer")) return { status: 200, body: { analysis: { v2Profile: null } } };
    return analysisOk();
  });
  const result = await runBulkRefresh({ rows: [entry("a"), entry("b"), entry("c")], fetch: fn });
  assert.deepEqual(
    result.outcomes.map((o) => [o.id, o.outcome, o.reason ?? null]),
    [
      ["a", "failed", "noNewerProfile"],
      ["b", "failed", "noNewerProfile"],
      ["c", "refreshed", null],
    ]
  );
  assert.deepEqual(puts(calls).map((c) => (c.body as { id: string }).id), ["c"]);
});

test("case 7b: any other PUT refusal is failed with the route's CODE (resolved later in the reader's language)", async () => {
  const { fn } = fakeFetch((url, method) =>
    method === "PUT" ? { status: 504, body: { error: "timeout", code: "PROFILE_BUILD_TIMEOUT" } } : analysisOk()
  );
  const result = await runBulkRefresh({ rows: [entry("a")], fetch: fn });
  assert.deepEqual(result.outcomes, [{ id: "a", outcome: "failed", reason: "PROFILE_BUILD_TIMEOUT" }]);
});

test("case 8: an edited row is never PUT even when every fetch would succeed — skippedEdited, and it is the review queue", async () => {
  const { fn, calls } = fakeFetch((url, method) => (method === "PUT" ? { status: 200, body: {} } : analysisOk()));
  const rows = [entry("a"), entry("b", { edited: true }), entry("c", { updatedAt: null })];
  const result = await runBulkRefresh({ rows, fetch: fn });
  assert.deepEqual(result.outcomes.map((o) => [o.id, o.outcome]), [
    ["a", "refreshed"],
    ["b", "skippedEdited"],
    ["c", "skippedEdited"],
  ]);
  assert.deepEqual(result.review.map((r) => [r.id, r.newerSlug]), [
    ["b", "b-newer"],
    ["c", "c-newer"],
  ]);
  assert.deepEqual(puts(calls).map((c) => (c.body as { id: string }).id), ["a"], "only the clean row was written");
  assert.ok(!calls.some((c) => c.url.includes("b-newer") || c.url.includes("c-newer")), "an edited row is not even read");
});

test("case 8b: aborting mid-run leaves every unstarted row notAttempted", async () => {
  const controller = new AbortController();
  const { fn, calls } = fakeFetch((url, method) => {
    if (method === "PUT") {
      // The recruiter presses Stop while row b's save is in flight: b's own write
      // still completes (a PUT is never cancelled half-way), and nothing after it runs.
      if ((calls[calls.length - 1].body as { id: string }).id === "b") controller.abort();
      return { status: 200, body: {} };
    }
    return analysisOk();
  });
  const progress: [number, number][] = [];
  const result = await runBulkRefresh({
    rows: [entry("a"), entry("b"), entry("c"), entry("d")],
    fetch: fn,
    signal: controller.signal,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["refreshed", "refreshed", "notAttempted", "notAttempted"]);
  assert.equal(result.stopped, "aborted");
  assert.equal(puts(calls).length, 2);
  assert.ok(puts(calls).every((c) => c.signal === undefined), "a save is never cancelled half-way (its outcome would be unknowable)");
  assert.deepEqual(progress.at(-1), [2, 4]);
});

test("case 8c: an abort before the run starts attempts nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fn, calls } = fakeFetch(() => analysisOk());
  const result = await runBulkRefresh({ rows: [entry("a"), entry("b")], fetch: fn, signal: controller.signal });
  assert.deepEqual(result.outcomes.map((o) => o.outcome), ["notAttempted", "notAttempted"]);
  assert.equal(calls.length, 0);
});
