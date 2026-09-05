// Pins the task dedupe-key contract (idea-5e38b9ad): a missing/empty identifying
// param must never collapse a key to a constant that merges unrelated runs.
// startTask reuses an in-flight task ONLY when buildDedupeKey returns a non-null
// (stable) key; a null result forces a guaranteed-unique key.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDedupeKey, stableKey } from "./task-dedupe.ts";
import { groupEvalDedupeKey } from "./group-eval-dedupe.ts";

test("stableKey joins present, non-empty parts with the prefix", () => {
  assert.equal(stableKey("analyze", "abc"), "analyze:abc");
  assert.equal(stableKey("automation", "e1", "screen"), "automation:e1:screen");
  assert.equal(stableKey("k", 0), "k:0", "0 is a valid, present value");
  assert.equal(stableKey("k", false), "k:false");
});

test("stableKey returns null when any required part is missing or blank", () => {
  assert.equal(stableKey("analyze", undefined), null);
  assert.equal(stableKey("analyze", null), null);
  assert.equal(stableKey("analyze", ""), null);
  assert.equal(stableKey("analyze", "   "), null, "whitespace-only is treated as empty");
  assert.equal(stableKey("reasoning", "who", undefined), null, "one missing part fails the whole key");
});

test("analyze: a missing baseDir does NOT collapse to a constant", () => {
  assert.equal(buildDedupeKey("analyze", { baseDir: "/uploads/u1" }), "analyze:/uploads/u1");
  // The bug: `analyze:${undefined}` => "analyze:undefined" matched every other
  // baseDir-less analyze. Now it yields null => startTask uses a unique key.
  assert.equal(buildDedupeKey("analyze", {}), null);
  assert.equal(buildDedupeKey("analyze", { baseDir: "" }), null);
});

test("group_eval / lifecycle / interview_prep / evaluate_submission reject missing identity", () => {
  // bug-ui-scan-2026-07-09 #3: the group_eval key now folds governance mode +
  // candidate-set fingerprint (see group-eval-dedupe.test.ts), so buildDedupeKey must
  // route through groupEvalDedupeKey rather than the old role-only `group_eval:backend`.
  assert.equal(buildDedupeKey("group_eval", { roleKey: "backend" }), groupEvalDedupeKey({ roleKey: "backend" }));
  assert.match(buildDedupeKey("group_eval", { roleKey: "backend" }) ?? "", /^group_eval:backend:recommendation:/);
  assert.equal(buildDedupeKey("group_eval", {}), null);
  assert.equal(buildDedupeKey("lifecycle", { lifecycleId: "lc1" }), "lifecycle:lc1");
  assert.equal(buildDedupeKey("lifecycle", {}), null);
  assert.equal(buildDedupeKey("interview_prep", { entryId: "pe1" }), "interview_prep:pe1:en");
  assert.equal(buildDedupeKey("interview_prep", {}), null);
  assert.equal(buildDedupeKey("evaluate_submission", { submissionId: "s1" }), "evaluate_submission:s1");
  assert.equal(buildDedupeKey("evaluate_submission", {}), null);
});

test("reasoning: any identity source works, all-absent yields null (was 'reasoning::undefined')", () => {
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1" }), "reasoning:p1:j1:en");
  assert.equal(buildDedupeKey("reasoning", { analysisSlug: "a1", jobId: "j1" }), "reasoning:a1:j1:en");
  assert.equal(
    buildDedupeKey("reasoning", { candidate: { name: "X" }, jobId: "j1" }),
    `reasoning:${JSON.stringify({ name: "X" })}:j1:en`
  );
  // profileId wins the fallback chain when several are present.
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1", analysisSlug: "a1", jobId: "j1" }), "reasoning:p1:j1:en");
  // No candidate identity at all, or no jobId → null, not a shared constant.
  assert.equal(buildDedupeKey("reasoning", { jobId: "j1" }), null);
  assert.equal(buildDedupeKey("reasoning", { profileId: "p1" }), null);
  assert.equal(buildDedupeKey("reasoning", {}), null);
});

// A LOCALIZED result is a different result. Both of these kinds generate their whole
// artifact in the requesting locale (the LLM directive + the deterministic
// scaffolding) and stamp it with that language, so "same entity" is NOT the same run
// — omitting the locale handed a second reader the in-flight run's foreign-language
// pack, exactly what `campaign` already folds the language to prevent.
test("reasoning / interview_prep fold the reader's locale into the key", () => {
  const cs = buildDedupeKey("interview_prep", { entryId: "pe1", lang: "cs" });
  const de = buildDedupeKey("interview_prep", { entryId: "pe1", lang: "de" });
  assert.notEqual(cs, de, "a de reader must not be handed the in-flight cs prep pack");
  // A true retry in the SAME language still dedupes onto the in-flight run.
  assert.equal(cs, buildDedupeKey("interview_prep", { entryId: "pe1", lang: "cs" }));

  assert.notEqual(
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "cs" }),
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "de" })
  );
  assert.equal(
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "cs" }),
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "cs" })
  );

  // Normalized the way the HANDLER narrows it: an absent or unsupported lang means
  // the run will produce DEFAULT_LOCALE output, so it keys onto the explicit-"en"
  // run rather than forking a second, identical one.
  assert.equal(
    buildDedupeKey("interview_prep", { entryId: "pe1" }),
    buildDedupeKey("interview_prep", { entryId: "pe1", lang: "en" })
  );
  assert.equal(
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "xx" }),
    buildDedupeKey("reasoning", { profileId: "p1", jobId: "j1", lang: "en" })
  );
  // The identity parts still gate the key: no locale can rescue a missing entity.
  assert.equal(buildDedupeKey("interview_prep", { lang: "cs" }), null);
  assert.equal(buildDedupeKey("reasoning", { jobId: "j1", lang: "cs" }), null);
});

test("automation: required entryId+task, optional notes flag appended only after a real key", () => {
  assert.equal(buildDedupeKey("automation", { entryId: "e1", task: "screen" }), "automation:e1:screen:");
  assert.equal(buildDedupeKey("automation", { entryId: "e1", task: "screen", notes: "x" }), "automation:e1:screen:n");
  assert.equal(buildDedupeKey("automation", { task: "screen" }), null, "missing entryId fails");
  assert.equal(buildDedupeKey("automation", { entryId: "e1" }), null, "missing task fails");
});

test("jd_build keeps required identity but allows empty optional discriminators", () => {
  assert.equal(buildDedupeKey("jd_build", { title: "Eng" }), "jd_build:Eng:0:");
  assert.equal(buildDedupeKey("jd_build", { title: "Eng", needText: "hello", repoUrl: "u" }), "jd_build:Eng:5:u");
  assert.equal(buildDedupeKey("jd_build", {}), null);
});

test("need_analysis / design_artifacts require a present need object", () => {
  assert.equal(buildDedupeKey("need_analysis", { need: { title: "t" } }), `need_analysis:${JSON.stringify({ title: "t" })}`);
  assert.equal(buildDedupeKey("need_analysis", {}), null, "absent need no longer collapses to need_analysis:{}");
  const need = { title: "t" };
  assert.equal(
    buildDedupeKey("design_artifacts", { need }),
    `design_artifacts:${JSON.stringify(need)}:${JSON.stringify({})}`
  );
  assert.equal(buildDedupeKey("design_artifacts", { analysis: { x: 1 } }), null, "need is the required identity");
});

test("batch_screen is an intentional singleton constant", () => {
  assert.equal(buildDedupeKey("batch_screen", {}), "batch_screen");
});

test("batch_outreach keys by the sorted cohort, deduping a re-fire of the same selection", () => {
  // Order-independent: the same set of ids in any order produces one key, so a
  // double-click on the same cohort dedupes onto the in-flight draft run.
  assert.equal(
    buildDedupeKey("batch_outreach", { entryIds: ["b", "a", "c"] }),
    buildDedupeKey("batch_outreach", { entryIds: ["a", "b", "c"] })
  );
  assert.equal(buildDedupeKey("batch_outreach", { entryIds: ["a", "b"] }), "batch_outreach:a,b");
  // A different cohort is a different run.
  assert.notEqual(
    buildDedupeKey("batch_outreach", { entryIds: ["a", "b"] }),
    buildDedupeKey("batch_outreach", { entryIds: ["a", "c"] })
  );
  // No selection → no stable identity (a unique key, never a merge).
  assert.equal(buildDedupeKey("batch_outreach", { entryIds: [] }), null);
  assert.equal(buildDedupeKey("batch_outreach", {}), null);
});

test("jd_build keys by jdSlug in the backgrounded flow, by input otherwise", () => {
  // Backgrounded generate: the placeholder JD's slug is the identity, so each
  // Generate is a distinct build and a retry (same slug) dedupes onto it.
  assert.equal(buildDedupeKey("jd_build", { jdSlug: "abcd2345", title: "Eng" }), "jd_build:abcd2345");
  // Legacy (no slug): the historical input-shaped key is byte-identical.
  assert.equal(
    buildDedupeKey("jd_build", { title: "Backend Engineer", needText: "hello world", repoUrl: "" }),
    "jd_build:Backend Engineer:11:"
  );
  // Two placeholder JDs with identical inputs must NOT collapse into one build.
  assert.notEqual(
    buildDedupeKey("jd_build", { jdSlug: "aaaa1111", title: "Eng", needText: "x" }),
    buildDedupeKey("jd_build", { jdSlug: "bbbb2222", title: "Eng", needText: "x" })
  );
});

test("an unknown kind has no builder and yields null (safe: forces a unique key)", () => {
  assert.equal(buildDedupeKey("does_not_exist", { anything: 1 }), null);
});

test("repo_scan keys by tenant + target, so two readings of one repo are one run", () => {
  // It used to key by the per-POST scan id, which is unique by construction — a key
  // that can never match anything is a dedupe that never dedupes, and a double-click
  // cloned the repository and ran the in-repo agent twice.
  assert.equal(
    buildDedupeKey("repo_scan", { scanId: "rscan_a", workspaceId: "ws1", repoUrl: "https://github.com/acme/app" }),
    buildDedupeKey("repo_scan", { scanId: "rscan_b", workspaceId: "ws1", repoUrl: "https://github.com/acme/app" }),
    "the same target in the same tenant is the same run whatever row asked for it"
  );
  // The workspace is IN the key: a builder only ever sees `params`, so without it
  // two tenants scanning the same public repo would share one run — and a dossier is
  // a full read of a codebase.
  assert.notEqual(
    buildDedupeKey("repo_scan", { scanId: "r1", workspaceId: "ws1", repoUrl: "https://github.com/acme/app" }),
    buildDedupeKey("repo_scan", { scanId: "r2", workspaceId: "ws2", repoUrl: "https://github.com/acme/app" })
  );
  assert.notEqual(
    buildDedupeKey("repo_scan", { scanId: "r1", workspaceId: "ws1", repoUrl: "https://github.com/acme/app" }),
    buildDedupeKey("repo_scan", { scanId: "r2", workspaceId: "ws1", rootPath: "/srv/apps/app" })
  );
  // No target at all is no identity: a unique key, never a colliding constant.
  assert.equal(buildDedupeKey("repo_scan", { scanId: "r1", workspaceId: "ws1" }), null);
  assert.equal(buildDedupeKey("repo_scan", { scanId: "r1", repoUrl: "https://github.com/acme/app" }), null);
});
