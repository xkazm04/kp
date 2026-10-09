// The Cohort Studio runner's pure core (analyze-cohort-run.ts runCohortCore) over injected
// deps — no Python, no store, no network. What it pins (the spark's acceptance #2):
//   - a reused member spends nothing (the analyze path, which carries the one-unit debit,
//     is never entered); a fresh member enters it exactly once;
//   - one member's failure is coded and does not fail the cohort; all failing does;
//   - GitHub runs for a technical role family with a CV-linked github.com handle, and not
//     for a non-technical one, a missing link, or a blind cohort;
//   - the two-order intersection keeps only what both orders commented;
//   - an abort stops scheduling new members.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COHORT_MEMBER_CONCURRENCY,
  CohortMemberError,
  buildCompareInput,
  intersectCompareRuns,
  parseCompareOutput,
  runCohortCore,
  type CohortRunDeps,
  type CompareOutput,
} from "./analyze-cohort-run.ts";
import { COHORT_DIMENSIONS, type CohortMember, type CohortView } from "../features/tools/analyze/cohort/cohortTypes.ts";
import type { AnalysisCohortMemberRecord, AnalysisCohortRecord } from "./db/analysis-cohorts.ts";
import type { ResolvedCohortSource } from "./analyze-cohort-proposal.ts";
import type { Analysis } from "./schemas.ts";

type Patch = Parameters<CohortRunDeps["updateMember"]>[1];

function record(ids: string[], opts: { blind?: boolean } = {}): AnalysisCohortRecord {
  return {
    id: "coh-test",
    workspaceId: "workspace",
    jdSlug: "role",
    status: "queued",
    blind: opts.blind ?? false,
    reportLang: "en",
    orderSeed: "coh-test",
    members: ids.map(
      (id): AnalysisCohortMemberRecord => ({
        memberId: id,
        label: `Label ${id}`,
        membership: "applicant",
        source: { kind: "analysis", slug: id },
        runState: "queued",
        analysisSlug: null,
        error: null,
      })
    ),
    comments: null,
    taskId: "t-1",
    createdAt: "2026-10-09T00:00:00.000Z",
    finishedAt: null,
  };
}

function analysisOf(roleFamily: string, links: string[]): Analysis {
  return { candidate: { roleFamily, links } } as unknown as Analysis;
}

function viewMember(m: AnalysisCohortMemberRecord, i: number): CohortMember {
  const cells = Object.fromEntries(
    COHORT_DIMENSIONS.map((d) => [d, { dimension: d, rating: 70 - i, tier: "solid", label: { key: "cells.x" } }])
  ) as CohortMember["cells"];
  const detail = Object.fromEntries(COHORT_DIMENSIONS.map((d) => [d, null])) as CohortMember["detail"];
  return {
    memberId: m.memberId,
    label: m.label,
    membership: m.membership,
    runState: m.runState,
    analysisSlug: m.analysisSlug,
    roleFamily: null,
    neutralIndex: i,
    fitRank: i + 1,
    decoyOf: null,
    cells,
    detail,
  };
}

const NO_CLAIMS = {
  overall: { leader: null, separation: "insideNoise" as const, robustness: "undetermined" as const },
  byDimension: Object.fromEntries(
    COHORT_DIMENSIONS.map((d) => [d, { dimension: d, leader: null, separation: "insideNoise" as const, rated: 0 }])
  ) as CohortView["claims"]["byDimension"],
};

/** A harness over an in-memory run sheet. `analyses` maps a member id to what its saved
 *  analysis says; `reuse` names members with a reusable analysis; `fail` members throw. */
function harness(
  rec: AnalysisCohortRecord,
  opts: {
    reuse?: string[];
    fail?: string[];
    analyses?: Record<string, Analysis>;
    hasGithub?: string[];
    githubBudget?: boolean;
    compare?: (order: string) => CompareOutput;
    signal?: AbortSignal;
    onAnalyze?: (id: string) => void;
  } = {}
) {
  const sheet = rec.members.map((m) => ({ ...m }));
  const calls = { analyzeFresh: [] as string[], github: [] as string[], status: [] as string[], compare: 0, comments: null as unknown };
  const deps: CohortRunDeps = {
    signal: opts.signal ?? new AbortController().signal,
    progress: () => {},
    load: () => ({ ...rec, members: sheet.map((m) => ({ ...m })) }),
    updateMember: (id: string, patch: Patch) => {
      const m = sheet.find((x) => x.memberId === id);
      if (m) Object.assign(m, patch);
    },
    setStatus: (s) => void calls.status.push(s),
    setComments: (c) => {
      calls.comments = c;
    },
    resolveSource: (id): ResolvedCohortSource => ({
      memberId: id,
      source: { kind: "analysis", slug: id },
      label: `Label ${id}`,
      roleFamily: null,
      seniority: null,
      cvSlug: id,
      cvHash: null,
    }),
    findReuse: (s) => ((opts.reuse ?? []).includes(s.memberId) ? `reused-${s.memberId}` : null),
    analyzeFresh: async (s) => {
      calls.analyzeFresh.push(s.memberId);
      opts.onAnalyze?.(s.memberId);
      await new Promise((r) => setTimeout(r, 1));
      if ((opts.fail ?? []).includes(s.memberId)) throw new CohortMemberError("ENGINE_FAILED");
      return `fresh-${s.memberId}`;
    },
    loadAnalysis: (slug) => {
      const id = slug.replace(/^(fresh|reused)-/, "");
      const analysis = opts.analyses?.[id] ?? analysisOf("general_professional", []);
      return { analysis, hasGithub: (opts.hasGithub ?? []).includes(id) };
    },
    githubAllowed: () => opts.githubBudget ?? true,
    runGithub: async (slug) => void calls.github.push(slug),
    parseGithubUsername: (link) => /github\.com\/([A-Za-z0-9-]+)/.exec(link)?.[1] ?? null,
    buildView: () =>
      ({
        cohortId: rec.id,
        status: "running",
        jdSlug: rec.jdSlug,
        jdTitle: "Role",
        orgName: null,
        blind: rec.blind,
        reportLang: rec.reportLang,
        createdAt: rec.createdAt,
        finishedAt: null,
        members: sheet.map(viewMember),
        claims: NO_CLAIMS,
        narrative: null,
        progress: { total: sheet.length, done: 0, reused: 0, failed: 0 },
      }) as CohortView,
    compare: async (input) => {
      calls.compare += 1;
      return opts.compare ? opts.compare(input.members[0]?.memberId ?? "") : { cells: [], notes: {}, narrative: null, engine: "keyless" };
    },
  };
  return { deps, sheet, calls };
}

test("a reused member spends nothing; a fresh member enters the analyze (debit) path exactly once", async () => {
  const rec = record(["a", "b", "c"]);
  const h = harness(rec, { reuse: ["a", "c"] });
  const summary = await runCohortCore(h.deps);
  assert.deepEqual(h.calls.analyzeFresh, ["b"], "only the fresh member reached runAnalyze (the one place a unit is debited)");
  assert.equal(h.sheet.find((m) => m.memberId === "a")?.runState, "reused");
  assert.equal(h.sheet.find((m) => m.memberId === "a")?.analysisSlug, "reused-a");
  assert.equal(h.sheet.find((m) => m.memberId === "b")?.runState, "done");
  assert.equal(summary.status, "done");
  assert.deepEqual([summary.reused, summary.done, summary.failed], [2, 1, 0]);
});

test("each fresh member is analysed once, however many there are", async () => {
  const ids = ["a", "b", "c", "d", "e"];
  const h = harness(record(ids));
  await runCohortCore(h.deps);
  assert.deepEqual([...h.calls.analyzeFresh].sort(), ids);
});

test("one member's failure is coded and the cohort continues", async () => {
  const h = harness(record(["a", "b", "c"]), { fail: ["b"] });
  const summary = await runCohortCore(h.deps);
  const b = h.sheet.find((m) => m.memberId === "b");
  assert.equal(b?.runState, "failed");
  assert.equal(b?.error, "ENGINE_FAILED");
  assert.equal(summary.status, "done");
  assert.deepEqual(h.calls.status, ["running", "done"]);
});

test("every member failing fails the cohort, and no comparative pass runs", async () => {
  const h = harness(record(["a", "b"]), { fail: ["a", "b"] });
  const summary = await runCohortCore(h.deps);
  assert.equal(summary.status, "failed");
  assert.equal(h.calls.compare, 0);
  assert.deepEqual(h.calls.status, ["running", "failed"]);
});

test("a member that no longer resolves fails with COHORT_MEMBER_NOT_FOUND", async () => {
  const h = harness(record(["a", "b"]));
  h.deps.resolveSource = (id) => (id === "a" ? null : { memberId: id, source: { kind: "analysis", slug: id }, label: id, roleFamily: null, seniority: null, cvSlug: id, cvHash: null });
  await runCohortCore(h.deps);
  assert.equal(h.sheet.find((m) => m.memberId === "a")?.error, "COHORT_MEMBER_NOT_FOUND");
});

test("GitHub runs for a technical family with a CV-linked github.com handle — and only then", async () => {
  const analyses = {
    tech: analysisOf("software_engineering", ["https://github.com/octo"]),
    data: analysisOf("data_ai", ["https://www.linkedin.com/in/x", "github.com/datahead"]),
    nontech: analysisOf("sales", ["https://github.com/seller"]),
    nolink: analysisOf("software_engineering", ["https://gitlab.com/x"]),
    already: analysisOf("software_engineering", ["https://github.com/done"]),
  };
  const h = harness(record(Object.keys(analyses)), { analyses, hasGithub: ["already"], reuse: ["data"] });
  await runCohortCore(h.deps);
  assert.deepEqual([...h.calls.github].sort(), ["fresh-tech", "reused-data"]);
});

test("a blind cohort never runs GitHub, and a spent budget skips it", async () => {
  const analyses = { tech: analysisOf("software_engineering", ["https://github.com/octo"]) };
  const blind = harness(record(["tech", "x"], { blind: true }), { analyses });
  await runCohortCore(blind.deps);
  assert.deepEqual(blind.calls.github, []);
  const throttled = harness(record(["tech", "x"]), { analyses, githubBudget: false });
  await runCohortCore(throttled.deps);
  assert.deepEqual(throttled.calls.github, []);
});

test("the two-order intersection keeps only the comments both orders produced", async () => {
  const runA: CompareOutput = {
    cells: [
      { memberId: "a", dimension: "skills", comment: "Both runs flagged this." },
      { memberId: "b", dimension: "trust", comment: "Only the neutral order said this." },
    ],
    notes: { fit: "Neutral note on fit.", skills: "Only neutral." },
    narrative: { covers: ["a", "zz"], leavesOut: 0, text: "Run one's narrative." },
    engine: "model",
  };
  const runB: CompareOutput = {
    cells: [{ memberId: "a", dimension: "skills", comment: "Different words, same cell." }],
    notes: { fit: "Reversed note on fit." },
    narrative: { covers: ["b"], leavesOut: 0, text: "Run two's narrative." },
    engine: "model",
  };
  const h = harness(record(["a", "b", "c"]), { compare: (first) => (first === "a" ? runA : runB) });
  await runCohortCore(h.deps);
  const comments = h.calls.comments as ReturnType<typeof intersectCompareRuns>;
  assert.equal(h.calls.compare, 2, "the pass ran under two orders");
  assert.deepEqual(comments.cells, [{ memberId: "a", dimension: "skills", comment: "Both runs flagged this." }], "run one's text, surviving cells only");
  assert.deepEqual(comments.notes, { fit: "Neutral note on fit." });
  assert.equal(comments.narrative?.text, "Run one's narrative.");
  assert.deepEqual(comments.narrative?.covers, ["a"], "covers restricted to the code-decided top");
  assert.equal(comments.narrative?.engine, "model");
});

test("the compare input carries the code's claims, both orders, and no CV text", () => {
  const rec = record(["a", "b", "c"]);
  const h = harness(rec);
  const view = h.deps.buildView();
  view.members.forEach((m) => (m.runState = "done"));
  const neutral = buildCompareInput(view, "neutral");
  const reversed = buildCompareInput(view, "reversed");
  assert.deepEqual(neutral.members.map((m) => m.memberId), ["a", "b", "c"]);
  assert.deepEqual(reversed.members.map((m) => m.memberId), ["c", "b", "a"]);
  assert.deepEqual(neutral.claims, NO_CLAIMS);
  assert.deepEqual(neutral.narrativeTop, ["a", "b", "c"]);
  assert.doesNotMatch(JSON.stringify(neutral), /rawText/);
});

test("intersection drops cells for unknown members or dimensions", () => {
  const input = buildCompareInput(
    { ...harness(record(["a", "b"])).deps.buildView(), members: record(["a", "b"]).members.map((m, i) => ({ ...viewMember(m, i), runState: "done" as const })) },
    "neutral"
  );
  const out = intersectCompareRuns(
    parseCompareOutput({ cells: [{ memberId: "zz", dimension: "fit", comment: "x" }, { memberId: "a", dimension: "charm", comment: "y" }], notes: {}, narrative: null, engine: "model" }),
    parseCompareOutput({ cells: [{ memberId: "zz", dimension: "fit", comment: "x" }, { memberId: "a", dimension: "charm", comment: "y" }], notes: {}, narrative: null, engine: "model" }),
    input
  );
  assert.deepEqual(out.cells, []);
  assert.equal(out.narrative, null);
});

test("an abort stops scheduling: no member starts after it, and the cohort is closed", async () => {
  const controller = new AbortController();
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const h = harness(record(ids), {
    signal: controller.signal,
    onAnalyze: (id) => {
      if (id === "a") controller.abort();
    },
  });
  await assert.rejects(runCohortCore(h.deps), (e: unknown) => e instanceof CohortMemberError);
  assert.ok(h.calls.analyzeFresh.length <= COHORT_MEMBER_CONCURRENCY, `started ${h.calls.analyzeFresh.length} after the abort`);
  assert.ok(h.sheet.filter((m) => m.runState === "queued").length >= ids.length - COHORT_MEMBER_CONCURRENCY);
  assert.equal(h.calls.compare, 0);
  assert.equal(h.calls.status.at(-1), "failed");
});
