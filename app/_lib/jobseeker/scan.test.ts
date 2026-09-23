// The scan end to end over FAKES: fixture adapters, an in-memory posting store and a
// scripted Python runner — no network, no interpreter, no DB. What is pinned is the
// orchestration the summary promises: every acquired posting ends up scored, a blocked
// source pauses without stopping its neighbours, no profile means no work, the deep-dive
// is bounded by the seeker's policy and stops at the first keyless answer, and the
// summary is the ScanSummary shape types.ts declares.
//
// KP_JOBSEEKER_SCAN_SPAWN=1 opts the two DETERMINISTIC CLIs (posting_structure_cli,
// match_cli) into real spawns for test (a); the model CLIs stay scripted either way.
//
// unit-db.ts first: the store modules the scan binds by default are imported for their
// types/signatures, and their db-path must never resolve to a developer's kp.sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../testing/unit-db.ts";
import { PipelineError } from "../python-runner.ts";
import { FetchHalt, type SourceAdapter } from "./adapters/types.ts";
import { deepDivePosting } from "./deepdive.ts";
import { runPythonCli, type CliCall, type CliRunner } from "./python-cli.ts";
import { runJobseekerScan, SCAN_SKIP_REASON, type ScanDeps } from "./scan.ts";
import type { JobseekerPosting, JobseekerProfile, JobseekerSource, RawPosting, ScanSummary } from "./types.ts";
import { EMPTY_PREFERENCES } from "./types.ts";

// ── fixtures ────────────────────────────────────────────────────────────────────────

const WS = "ws-scan";
const NOW = "2026-09-16T10:00:00.000Z";

function raw(n: number, sourceTag: string): RawPosting {
  return {
    externalKey: `${sourceTag}-${n}`,
    url: `https://${sourceTag}.example/jobs/${n}`,
    title: `TypeScript Engineer ${n}`,
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `We are hiring a TypeScript engineer (${n}).\nRequirements: TypeScript, React, Node.js. 3+ years.`,
    jsonld: null,
    lang: "en",
  };
}

function source(id: string, config: Record<string, unknown> = {}): JobseekerSource {
  return {
    id,
    kind: "board",
    adapter: "board_sitemap_jsonld",
    tier: "B",
    host: `${id}.example`,
    config,
    enabled: true,
    acknowledgedAt: NOW,
    acknowledgedTermsHash: "x",
    pausedReason: null,
    pausedAt: null,
    rules: null,
    rulesBaseline: null,
    lastRunAt: null,
    lastOutcome: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const profile: JobseekerProfile = {
  id: "jsp-1",
  profile: { displayName: "Seeker", roleFamily: "engineering", seniority: "senior", skillClaims: [{ skill: "TypeScript", level: "expert" }] },
  preferences: { ...EMPTY_PREFERENCES, deepDive: { threshold: 65, maxPerScan: 3 } },
  cvSourceText: null,
  cvPolishedMd: null,
  cvHash: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/** A fixture adapter: `config.postings` is the RawPosting list; `config.blocked` makes the
 *  first fetch a denial. No `ctx.fetch` call is ever made. */
const fixtureAdapter: SourceAdapter = {
  name: "board_sitemap_jsonld",
  detailFetches: false,
  async *discover(ctx) {
    if (ctx.source.config.blocked) throw new FetchHalt({ kind: "blocked", status: 403, detail: "403 on the sitemap" });
    for (const p of ctx.source.config.postings as RawPosting[]) yield { externalKey: p.externalKey, url: p.url, hint: p };
  },
  async detail(ref) {
    return (ref.hint as RawPosting) ?? null;
  },
};

// ── the in-memory store ─────────────────────────────────────────────────────────────

type Row = JobseekerPosting;

function makeStore() {
  const rows = new Map<string, Row>();
  const paused: { id: string; reason: string }[] = [];
  const runs: { id: string; outcome: string }[] = [];
  let seq = 0;
  const store = {
    rows,
    paused,
    runs,
    deps: {
      upsertPosting: (sourceId, r, seenAt) => {
        const existing = [...rows.values()].find((x) => x.sourceId === sourceId && x.externalKey === r.externalKey);
        if (existing) {
          existing.lastSeenAt = seenAt;
          return { id: existing.id, outcome: "unchanged" as const };
        }
        const id = `jpo-${++seq}`;
        rows.set(id, {
          id,
          sourceId,
          externalKey: r.externalKey,
          url: r.url,
          title: r.title,
          company: r.company,
          location: r.location,
          country: r.country,
          workMode: r.workMode,
          postedAt: r.postedAt,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          salaryPeriod: null,
          bodyText: r.bodyText,
          jsonld: r.jsonld,
          contentHash: "h",
          job: null,
          jobSource: null,
          match: null,
          matchTotal: null,
          fitTier: null,
          matchVersion: null,
          matchedAt: null,
          reasoning: null,
          status: "new",
          dismissReason: null,
          dismissNote: null,
          appliedAt: null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          goneAt: null,
        });
        return { id, outcome: "new" as const };
      },
      markAbsent: () => 0,
      recordSourceRun: (id, outcome) => {
        runs.push({ id, outcome });
        return true;
      },
      pauseSource: (id, reason) => {
        paused.push({ id, reason });
        return true;
      },
      listPostingsNeedingStructure: () => [...rows.values()].filter((r) => r.job === null).map((r) => ({ id: r.id, raw: raw(0, "x") })),
      setPostingStructure: (id, job, jobSource) => {
        const r = rows.get(id);
        if (!r) return false;
        r.job = job;
        r.jobSource = jobSource;
        return true;
      },
      // Mirrors the store's incremental predicate (jobseeker-postings.ts): an up-to-date
      // row is one stamped with THIS match version and scored at or after the profile's
      // last write; everything else still owes a score.
      listPostingsForMatching: (_ws, scope) => {
        const live = [...rows.values()].filter((r) => r.job !== null && r.status !== "dismissed" && r.status !== "gone");
        const upToDate = (r: Row) =>
          scope !== undefined && r.matchVersion === scope.upToDateVersion && r.matchedAt !== null && r.matchedAt >= scope.profileUpdatedAt;
        return {
          rows: live.filter((r) => !upToDate(r)).map((r) => ({ id: r.id, job: r.job! })),
          skippedUpToDate: live.filter(upToDate).length,
        };
      },
      setPostingMatch: (id, match, projection) => {
        const r = rows.get(id);
        if (!r) return false;
        r.match = match;
        r.matchTotal = projection.total;
        r.fitTier = projection.fitTier;
        r.matchVersion = projection.version;
        r.matchedAt = projection.matchedAt;
        return true;
      },
      // Mirrors setPostingBlocked's re-check: a row whose structure was cleared (content
      // changed after the list) is not stamped.
      setPostingBlocked: (id, verdict, projection) => {
        const r = rows.get(id);
        if (!r || r.job === null) return false;
        r.match = verdict;
        r.matchTotal = null;
        r.fitTier = null;
        r.matchVersion = projection.version;
        r.matchedAt = projection.matchedAt;
        return true;
      },
      setPostingReasoning: (id, reasoning) => {
        const r = rows.get(id);
        if (!r) return false;
        r.reasoning = reasoning;
        return true;
      },
      listDeepDiveCandidates: ({ threshold, limit }) =>
        [...rows.values()]
          .filter((r) => r.matchTotal !== null && r.matchTotal >= threshold && r.reasoning === null && r.status !== "dismissed" && r.status !== "gone")
          .sort((a, b) => (b.matchTotal ?? 0) - (a.matchTotal ?? 0))
          .slice(0, limit),
    } satisfies Partial<ScanDeps> & { setPostingReasoning: (id: string, reasoning: Record<string, unknown>) => boolean },
  };
  return store;
}

// ── the scripted Python runner ──────────────────────────────────────────────────────

type Script = {
  /** total per posting id for match_cli (default 70); a missing id is KO'd. */
  totals?: (id: string) => number | null;
  /** reasoning_cli's `source` per call index. */
  reasoningSource?: (call: number) => "llm" | "deterministic";
  /** jobs_cli: throw the keyless refusal. */
  keyless?: boolean;
};

function scriptedRunner(script: Script, calls: CliCall[]): CliRunner {
  let reasoningCalls = 0;
  return async (call) => {
    calls.push(call);
    const f = call.files;
    switch (call.module) {
      case "posting_structure_cli": {
        const items = f["input.json"] as { id: string; raw: RawPosting }[];
        return { jobs: items.map((it) => ({ id: it.id, job: { id: it.id, title: it.raw.title, company: "Example", location: "Praha" } })), notes: [] };
      }
      case "match_cli": {
        const jobs = f["jobs.json"] as { id: string }[];
        const matches = jobs
          .map((j) => ({ id: j.id, total: script.totals ? script.totals(j.id) : 70 }))
          .filter((m): m is { id: string; total: number } => m.total !== null)
          .map((m) => ({ jobId: m.id, total: m.total, fitTier: m.total >= 70 ? "strong" : "partial", confidence: { low: m.total - 5, high: m.total + 5, level: "tight" }, eligibility: [] }));
        // A null total is a KO: with --include-blocked the matcher names the gate and
        // scores the posting as if it were lifted (matching.py BlockedMatch).
        const asked = call.args({ "profile.json": "p", "preferences.json": "q", "corpus.json": "c", "jobs.json": "j" }).includes("--include-blocked");
        const blocked = jobs
          .filter((j) => (script.totals ? script.totals(j.id) : 70) === null)
          .map((j) => ({
            jobId: j.id,
            koKeys: ["work_mode"],
            koDetails: ["work mode onsite not preferred"],
            result: { jobId: j.id, total: 78, fitTier: "strong", eligibility: [{ key: "work_mode", state: "flag", detail: "work mode onsite not preferred" }] },
          }));
        return { matches, meta: { evaluated: jobs.length, koFiltered: jobs.length - matches.length, koReasons: [] }, ...(asked ? { blocked } : {}) };
      }
      case "jobs_cli": {
        if (script.keyless) throw new PipelineError({ message: "No LLM provider available for ad ingestion (configure one in Models, or install the Claude CLI).", status: 500, code: "engine_error" });
        return { job: { id: call.args({ "ad.txt": "ad.txt" })[4], title: "LLM-structured", company: "Example", location: "Praha", requirements: [] }, source: "llm" };
      }
      case "reasoning_cli": {
        const source = script.reasoningSource ? script.reasoningSource(reasoningCalls++) : "llm";
        return { jobId: "x", total: 70, source, narrativeLang: "en", promptVersion: "match-reasoning-v5", reasoning: { verdict: source === "llm" ? "strong" : "template" } };
      }
      default:
        throw new Error(`unscripted module ${call.module}`);
    }
  };
}

/** Real spawns for the deterministic CLIs when opted in; the model CLIs stay scripted. */
function runnerFor(script: Script, calls: CliCall[]): CliRunner {
  const scripted = scriptedRunner(script, calls);
  if (process.env.KP_JOBSEEKER_SCAN_SPAWN !== "1") return scripted;
  return async (call) => {
    if (call.module !== "posting_structure_cli" && call.module !== "match_cli") return scripted(call);
    calls.push(call);
    return runPythonCli(call);
  };
}

function depsFor(
  store: ReturnType<typeof makeStore>,
  runCli: CliRunner,
  sources: JobseekerSource[],
  withProfile = true,
  seeker: JobseekerProfile = profile
): Partial<ScanDeps> {
  return {
    now: () => NOW,
    getProfile: () => (withProfile ? seeker : null),
    listSources: () => sources,
    adapterFor: () => fixtureAdapter,
    fetch: async () => {
      throw new Error("the fixture adapter never fetches");
    },
    ...store.deps,
    runCli,
    deepDive: (posting, prof, opts) =>
      deepDivePosting(posting, prof, {
        ...opts,
        deps: {
          runCli,
          setPostingStructure: store.deps.setPostingStructure,
          setPostingMatch: store.deps.setPostingMatch,
          setPostingReasoning: store.deps.setPostingReasoning,
          now: () => NOW,
          log: () => undefined,
        },
      }),
    log: () => undefined,
  };
}

// ── tests ───────────────────────────────────────────────────────────────────────────

test("(a) 30 fixture postings: every row is structured and carries a match_total after one scan", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  const postings = Array.from({ length: 30 }, (_, i) => raw(i + 1, "alpha"));
  // Nothing above the deep-dive threshold here (scripted 60) — this test is about the
  // deterministic phases; under KP_JOBSEEKER_SCAN_SPAWN=1 the real matcher decides.
  const runCli = runnerFor({ totals: () => 60, reasoningSource: () => "deterministic" }, calls);
  const summary = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, runCli, [source("alpha", { postings })]) });

  assert.equal(summary.sources.length, 1);
  assert.equal(summary.sources[0].outcome, "succeeded");
  assert.equal(summary.sources[0].new, 30);
  assert.equal(store.rows.size, 30);
  for (const row of store.rows.values()) {
    assert.ok(row.job, `${row.id} structured`);
    assert.equal(row.jobSource, "deterministic");
    assert.equal(typeof row.matchTotal, "number", `${row.id} scored`);
    assert.ok(row.fitTier, `${row.id} banded`);
    assert.equal(row.matchVersion, "jobseeker-match-v2");
  }
  assert.equal(summary.matched, 30);
  // ONE structure spawn (30 < 200) and ONE match spawn (30 < 500).
  assert.deepEqual(
    calls.map((c) => c.module).filter((m) => m !== "jobs_cli" && m !== "reasoning_cli"),
    ["posting_structure_cli", "match_cli"]
  );
  const matchCall = calls.find((c) => c.module === "match_cli")!;
  const argv = matchCall.args({ "profile.json": "P", "preferences.json": "R", "corpus.json": "C", "jobs.json": "J" });
  assert.deepEqual(argv, ["--profile-json", "P", "--preferences-json", "R", "--jobs", "C", "--jobs-json", "J", "--limit", "30", "--include-blocked"]);
  assert.deepEqual(matchCall.files["corpus.json"], [], "the seed corpus is replaced by an empty one: only the seeker's postings rank");
  assert.equal(matchCall.llm, undefined, "the matcher is deterministic and is not handed the LLM config");
});

test("(b) a blocked source records `blocked`, is paused, and the other sources still run", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  const runCli = runnerFor({ totals: () => 60 }, calls);
  const sources = [source("blocked-board", { blocked: true }), source("beta", { postings: [raw(1, "beta"), raw(2, "beta")] })];
  const summary = await runJobseekerScan(WS, { trigger: "clock", deps: depsFor(store, runCli, sources) });

  assert.equal(summary.sources.length, 2);
  const [blocked, beta] = summary.sources;
  assert.equal(blocked.sourceId, "blocked-board");
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.reason, "blocked");
  assert.deepEqual(store.paused, [{ id: "blocked-board", reason: "blocked" }], "a denial pauses the source; only the owner resumes it");
  assert.equal(beta.outcome, "succeeded");
  assert.equal(beta.new, 2);
  assert.equal(store.rows.size, 2, "the neighbour's postings landed");
  assert.deepEqual(store.runs.map((r) => r.outcome), ["blocked", "succeeded"]);
  assert.equal(summary.matched, 2);
});

test("(c) no profile: no acquisition, no spawn, `deepDiveSkipped: no_profile`", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  const runCli = runnerFor({}, calls);
  const summary = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, runCli, [source("alpha", { postings: [raw(1, "alpha")] })], false) });
  assert.deepEqual(summary.sources, []);
  assert.equal(summary.matched, 0);
  assert.equal(summary.deepDived, 0);
  assert.equal(summary.deepDiveSkipped, "no_profile");
  assert.equal(calls.length, 0, "a scan with no reader spends nothing");
  assert.equal(store.rows.size, 0);
});

test("(d) the deep-dive takes min(maxPerScan, above-threshold) best-first and stops at the first deterministic answer", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  // 6 postings: totals 90, 85, 80, 75, 70 (five above 65) and 40. maxPerScan = 3.
  const totals = new Map<string, number>();
  const runCli = scriptedRunner(
    {
      totals: (id) => totals.get(id) ?? 40,
      // The third rationale comes back as the template: persisted count stays at 2.
      reasoningSource: (n) => (n < 2 ? "llm" : "deterministic"),
    },
    calls
  );
  const postings = Array.from({ length: 6 }, (_, i) => raw(i + 1, "alpha"));
  // Ids are minted in upsert order: jpo-1..jpo-6.
  [90, 85, 80, 75, 70, 40].forEach((t, i) => totals.set(`jpo-${i + 1}`, t));
  const summary = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, runCli, [source("alpha", { postings })]) });

  assert.equal(summary.deepDived, 2);
  assert.equal(summary.deepDiveSkipped, "no_provider");
  const reasoned = [...store.rows.values()].filter((r) => r.reasoning !== null).map((r) => r.id);
  assert.deepEqual(reasoned, ["jpo-1", "jpo-2"], "best-first; the deterministic third is NOT persisted");
  const dives = calls.filter((c) => c.module === "jobs_cli").length;
  assert.equal(dives, 3, "three shortlisted postings were attempted (maxPerScan), never the fourth");
  assert.equal(calls.filter((c) => c.module === "reasoning_cli").length, 3);
  // The model-structured job replaced the deterministic one and the posting was re-matched.
  assert.equal(store.rows.get("jpo-1")!.jobSource, "llm");
  assert.equal(calls.filter((c) => c.module === "match_cli").length, 1 + 3, "one dataset match plus one re-match per restructured posting");
  for (const c of calls.filter((x) => x.module === "jobs_cli" || x.module === "reasoning_cli")) assert.equal(c.llm, true, `${c.module} is handed the LLM config`);
});

test("(d') keyless: jobs_cli's refusal ends the deep-dive after ONE spawn and nothing is persisted", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  const runCli = scriptedRunner({ totals: () => 90, keyless: true }, calls);
  const postings = Array.from({ length: 5 }, (_, i) => raw(i + 1, "alpha"));
  const summary = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, runCli, [source("alpha", { postings })]) });
  assert.equal(summary.deepDived, 0);
  assert.equal(summary.deepDiveSkipped, "no_provider");
  assert.deepEqual(calls.map((c) => c.module), ["posting_structure_cli", "match_cli", "jobs_cli"], "one cheap probe, then stop");
  assert.ok([...store.rows.values()].every((r) => r.reasoning === null && r.jobSource === "deterministic"));
});

test("(e) the summary is the ScanSummary shape, and an aborted budget records unreached sources as `skipped`", async () => {
  const store = makeStore();
  const calls: CliCall[] = [];
  const runCli = scriptedRunner({ totals: () => 60 }, calls);
  const controller = new AbortController();
  controller.abort(new Error("caller gave up"));
  const summary = await runJobseekerScan(WS, {
    trigger: "clock",
    signal: controller.signal,
    deps: depsFor(store, runCli, [source("alpha", { postings: [raw(1, "alpha")] }), source("beta", { postings: [raw(1, "beta")] })]),
  });
  const expectedKeys: (keyof ScanSummary)[] = [
    "workspaceId",
    "trigger",
    "startedAt",
    "finishedAt",
    "sources",
    "matched",
    "skippedUpToDate",
    "deepDived",
    "deepDiveSkipped",
  ];
  assert.deepEqual(Object.keys(summary).sort(), [...expectedKeys].sort());
  assert.equal(summary.workspaceId, WS);
  assert.equal(summary.trigger, "clock");
  assert.equal(summary.startedAt, NOW);
  assert.equal(summary.finishedAt, NOW);
  assert.deepEqual(
    summary.sources.map((s) => [s.sourceId, s.outcome, s.reason]),
    [
      ["alpha", "skipped", SCAN_SKIP_REASON],
      ["beta", "skipped", SCAN_SKIP_REASON],
    ],
    "an unreached source is recorded, never omitted"
  );
  assert.equal(calls.length, 0, "an aborted scan spawns nothing");
  assert.equal(summary.deepDiveSkipped, null);
});

test("(f) incremental matching: an unchanged second scan scores nothing, a moved profile re-scores all, a changed posting re-scores itself", async () => {
  const store = makeStore();
  const postings = Array.from({ length: 4 }, (_, i) => raw(i + 1, "alpha"));
  const sources = [source("alpha", { postings })];
  const matchSpawns = (calls: CliCall[]) => calls.filter((c) => c.module === "match_cli").length;

  // First scan: nothing is stored, so all four are scored.
  const first: CliCall[] = [];
  const one = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, scriptedRunner({ totals: () => 60 }, first), sources) });
  assert.equal(one.matched, 4);
  assert.equal(one.skippedUpToDate, 0);
  assert.equal(matchSpawns(first), 1);

  // Second scan, nothing changed: every row is stamped with this version at or after the
  // profile's updated_at, so the matcher is never spawned.
  const second: CliCall[] = [];
  const two = await runJobseekerScan(WS, { trigger: "clock", deps: depsFor(store, scriptedRunner({ totals: () => 60 }, second), sources) });
  assert.equal(two.matched, 0, "no row owed a score");
  assert.equal(two.skippedUpToDate, 4, "and the scan says so rather than reporting an empty dataset");
  assert.equal(matchSpawns(second), 0, "a no-change re-scan spawns the matcher zero times");

  // The seeker edits their preferences: every stored score predates the inputs it was
  // computed from, so all four come back.
  const moved: JobseekerProfile = { ...profile, updatedAt: "2026-09-16T12:00:00.000Z" };
  const third: CliCall[] = [];
  const withMovedProfile = await runJobseekerScan(WS, {
    trigger: "manual",
    deps: depsFor(store, scriptedRunner({ totals: () => 60 }, third), sources, true, moved),
  });
  assert.equal(withMovedProfile.matched, 4, "a changed profile invalidates every stored score");
  assert.equal(withMovedProfile.skippedUpToDate, 0);
  assert.equal(matchSpawns(third), 1);
  // …and the rows are now stamped at NOW again, which is BEFORE the moved profile's
  // updated_at — so scan five below uses the original profile, whose updated_at they clear.

  // A posting whose content moved: upsertPosting nulls its structure and match, and only
  // that row is re-structured and re-scored.
  const changed = [...store.rows.values()][1];
  changed.job = null;
  changed.jobSource = null;
  changed.match = null;
  changed.matchTotal = null;
  changed.fitTier = null;
  changed.matchVersion = null;
  changed.matchedAt = null;
  const fourth: CliCall[] = [];
  const four = await runJobseekerScan(WS, { trigger: "clock", deps: depsFor(store, scriptedRunner({ totals: () => 60 }, fourth), sources) });
  assert.equal(four.matched, 1, "only the posting whose content changed is re-scored");
  assert.equal(four.skippedUpToDate, 3);
  const matchCall = fourth.find((c) => c.module === "match_cli")!;
  assert.deepEqual((matchCall.files["jobs.json"] as { id: string }[]).map((j) => j.id), [changed.id]);
});

test("(g) a KO'd posting is stored once with its gate and as-if score, and the next unchanged scan skips it", async () => {
  const store = makeStore();
  const postings = Array.from({ length: 3 }, (_, i) => raw(i + 1, "alpha"));
  const sources = [source("alpha", { postings })];
  const matchSpawns = (calls: CliCall[]) => calls.filter((c) => c.module === "match_cli").length;
  // jpo-2 fails the hard filter; the other two score 60.
  const totals = (id: string) => (id === "jpo-2" ? null : 60);

  const first: CliCall[] = [];
  const one = await runJobseekerScan(WS, { trigger: "manual", deps: depsFor(store, scriptedRunner({ totals }, first), sources) });
  assert.equal(one.matched, 2, "only survivors count as scored");
  const blocked = store.rows.get("jpo-2")!;
  assert.equal(blocked.matchTotal, null, "a filtered posting is not a 0 % fit and never sorts as a score");
  assert.equal(blocked.fitTier, null);
  assert.equal(blocked.matchVersion, "jobseeker-match-v2");
  assert.equal(blocked.matchedAt, NOW);
  assert.deepEqual(blocked.match, {
    blocked: { koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"] },
    asIf: { jobId: "jpo-2", total: 78, fitTier: "strong", eligibility: [{ key: "work_mode", state: "flag", detail: "work mode onsite not preferred" }] },
  });

  // Unchanged second scan: the stamped verdict is current, so the matcher is not spawned
  // for it (it used to be re-sent on every scan because nothing ever stamped it).
  const second: CliCall[] = [];
  const two = await runJobseekerScan(WS, { trigger: "clock", deps: depsFor(store, scriptedRunner({ totals }, second), sources) });
  assert.equal(two.skippedUpToDate, 3, "the blocked row counts as already current");
  assert.equal(matchSpawns(second), 0, "and nothing is re-sent to the matcher");
});
