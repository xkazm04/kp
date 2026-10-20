// The verdict run's aggregation and artifacts (spark interview-uat-tranche, WP-2) — on
// hand-built dumps in temp directories, no database, no model: the severity derivation
// table, the heatmap's sort, the /uat findings schema and its strength rows, the
// instrument-identity refusal, two runs merged as RATES, the judge cache, the same-model
// refusal, and the Character voices.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildDump, TEST_AGENDA, type BuildStep } from "./dump-builder.ts";
import type { SimConversationDump } from "./engine.ts";
import { fakeCharacterVoice, fakeJudge } from "./fake.ts";
import {
  deriveSeverity,
  DIMENSIONS,
  FINDING_TYPES,
  IMPACT_LEVELS,
  impactRank,
  InstrumentIdentityError,
  JudgeIndependenceError,
  SEVERITIES,
  sortGroups,
  verdictRuns,
  type GroupRow,
  type Impact,
  type UatFinding,
} from "./verdict-run.ts";

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
function tempRoot(): string {
  const r = mkdtempSync(path.join(tmpdir(), "kp-sim-verdict-"));
  roots.push(r);
  return r;
}

const OPEN = "Hello, I'm an AI assistant for Northwind Payments. This call is transcribed for a human recruiter.";
const CLOSE = "Thank you for your time today. A human recruiter will review this conversation and be in touch.";
const clean = (extra: BuildStep[] = []): BuildStep[] => [
  { tool: "begin_topic", args: { block_id: "b0" } },
  { iv: OPEN },
  { cand: "Hi, thanks for having me." },
  { tool: "begin_topic", args: { block_id: "b1" } },
  { iv: "Walk me through a service you owned end to end." },
  ...extra,
  { cand: "I owned the payments ledger service end to end for three years." },
  { tool: "mark_topic_covered", args: { block_id: "b1", evidence_quote: "I owned the payments ledger service end to end" } },
  { tool: "begin_topic", args: { block_id: "b2" } },
  { iv: "Tell me about a technical disagreement with a colleague." },
  { cand: "We disagreed about the ORM, so I benchmarked both options on production data." },
  { tool: "mark_topic_covered", args: { block_id: "b2", evidence_quote: "I benchmarked both options on production data" } },
  { tool: "begin_topic", args: { block_id: "b4" } },
  { tool: "end_interview", args: { reason: "complete" } },
  { iv: CLOSE },
];
const praising = clean([{ cand: "It was the ledger." }, { iv: "That's a great answer. What was your own part in it?" }]);

/** Write a simulator output directory the way runner.ts does. */
function writeRun(dir: string, dumps: SimConversationDump[], opts: { interviewerModel?: string | null } = {}): string {
  mkdirSync(path.join(dir, "instruments"), { recursive: true });
  for (const d of dumps) writeFileSync(path.join(dir, `${d.situationId}.json`), `${JSON.stringify(d, null, 2)}\n`);
  const shas = [...new Set(dumps.map((d) => d.instrument.briefSha))];
  for (const sha of shas) {
    const brief = "Ask one question. ROLE FACTS — title: Backend Engineer; company: Northwind Payments. Do not give feedback.";
    writeFileSync(path.join(dir, "instruments", `kit.en-${sha.replace(/\W/g, "").slice(0, 12)}.json`), JSON.stringify({ key: "kit.en", fixture: "kit", locale: "en", agenda: TEST_AGENDA, privateBrief: brief, candidateBrief: brief, record: { briefSha: sha, agendaBlockIds: TEST_AGENDA.blocks.map((b) => b.id), directorVersion: "sha256:dir" } }));
  }
  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runs: [{ runId: dumps[0]?.runId ?? "run", provider: "fake", interviewerModel: opts.interviewerModel ?? null }],
    conversations: dumps.map((d) => ({ situationId: d.situationId, file: `${d.situationId}.json` })),
  };
  writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  return dir;
}

const dump = (situationId: string, steps: BuildStep[], over: Partial<SimConversationDump> = {}, runId = "run-a") => ({ ...buildDump(steps, { situationId, runId }), ...over });

test("severity is DERIVED from impact — the table, and quality never above minor", () => {
  const cases: [Impact, "reliability" | "protocol" | "policy" | "quality", string][] = [
    [{ frequency: "high", reachability: "high", trust_erosion: "high" }, "reliability", "blocker"],
    [{ frequency: "med", reachability: "high", trust_erosion: "high" }, "reliability", "blocker"],
    [{ frequency: "low", reachability: "high", trust_erosion: "high" }, "reliability", "major"],
    [{ frequency: "high", reachability: "low", trust_erosion: "high" }, "policy", "major"],
    [{ frequency: "low", reachability: "high", trust_erosion: "med" }, "protocol", "minor"],
    [{ frequency: "low", reachability: "low", trust_erosion: "med" }, "protocol", "polish"],
    [{ frequency: "high", reachability: "high", trust_erosion: "low" }, "quality", "minor"],
    [{ frequency: "low", reachability: "low", trust_erosion: "low" }, "quality", "polish"],
  ];
  for (const [impact, axis, want] of cases) assert.equal(deriveSeverity(impact, axis), want, `${JSON.stringify(impact)} ${axis}`);
  assert.equal(impactRank({ frequency: "high", reachability: "high", trust_erosion: "high" }), 27);
  // A breach every candidate meets outranks a severe one nobody reaches.
  assert.ok(impactRank({ frequency: "high", reachability: "high", trust_erosion: "med" }) > impactRank({ frequency: "high", reachability: "low", trust_erosion: "high" }));
});

test("the heatmap sorts worst reliability first, ties toward the larger group", () => {
  const row = (key: string, n: number, fail: number, evaluable: number): GroupRow => ({
    key,
    n,
    axes: { reliability: { fail, evaluable }, protocol: { fail: 0, evaluable }, policy: { fail: 0, evaluable: 0 } },
    notProvoked: 0,
    notEvaluable: 0,
    failing: [],
  });
  const sorted = sortGroups([row("clean", 9, 0, 9), row("half-small", 2, 1, 2), row("half-large", 6, 3, 6), row("worst", 1, 1, 1)]);
  assert.deepEqual(sorted.map((r) => r.key), ["worst", "half-large", "half-small", "clean"]);
});

test("findings.json: the /uat schema exactly, valid enums, strengths only at three or more evaluable conversations", async () => {
  const root = tempRoot();
  const dir = writeRun(path.join(root, "run-a"), [
    dump("kit-concrete_doer-en", praising),
    dump("kit-terse-en", clean()),
    dump("kit-strong-cs", clean()),
    dump("prep-strong-en", clean()),
  ]);
  const res = await verdictRuns({ dirs: [dir], outDir: path.join(root, "out") });
  const findings = JSON.parse(readFileSync(path.join(root, "out", "findings.json"), "utf8")) as UatFinding[];
  assert.ok(Array.isArray(findings) && findings.length > 0);
  const keys = ["id", "journey", "character", "cert_level", "type", "severity", "impact", "dimension", "title", "expected", "got", "evidence", "code_check", "verdict", "resolution", "recurrence", "suggested_acceptance"];
  for (const f of findings) {
    assert.deepEqual(Object.keys(f).sort(), [...keys].sort(), f.id);
    assert.equal(f.journey, "interview-conduct");
    assert.equal(f.cert_level, "LC");
    assert.ok((FINDING_TYPES as readonly string[]).includes(f.type), f.type);
    assert.ok((SEVERITIES as readonly string[]).includes(f.severity), f.severity);
    assert.ok((DIMENSIONS as readonly string[]).includes(f.dimension), f.dimension);
    for (const k of ["frequency", "reachability", "trust_erosion"] as const) assert.ok((IMPACT_LEVELS as readonly string[]).includes(f.impact[k]), `${f.id} ${k}`);
    assert.equal(f.code_check, "n-a");
    assert.equal(f.verdict, "uncertain", "the tool never claims confirmed");
    assert.equal(f.resolution, "open");
    assert.equal(f.recurrence, 1);
    for (const e of f.evidence) assert.match(e, /^transcript:run-a\/[a-z0-9_-]+(#\d+)?$/);
  }
  const praise = findings.find((f) => f.id === "LC-NO-PRAISE");
  assert.ok(praise, "a failing invariant is one finding");
  assert.equal(praise?.type, "trust");
  assert.equal(praise?.character, "sim:concrete_doer");
  assert.deepEqual(praise?.impact, { frequency: "med", reachability: "high", trust_erosion: "high" }, "1 of 4 evaluable is at least a fifth: med");
  assert.equal(praise?.severity, "blocker");
  assert.ok(praise?.evidence.some((e) => e.startsWith("transcript:run-a/kit-concrete_doer-en#")));
  const strengths = findings.filter((f) => f.type === "strength");
  assert.ok(strengths.length > 0 && strengths.every((s) => s.severity === "polish"));
  assert.ok(strengths.some((s) => s.id === "LC-NO-DECISION-S"), "held in 4 evaluable conversations");
  assert.ok(!strengths.some((s) => s.id === "LC-NO-PRAISE-S"), "a failing invariant is never also a strength");
  // An invariant evaluable in fewer than three conversations earns no strength row.
  const few = await verdictRuns({ dirs: [writeRun(path.join(root, "run-b"), [dump("kit-terse-en", clean()), dump("prep-strong-en", clean())])], outDir: path.join(root, "out-b") });
  assert.equal(few.findings.filter((f) => f.type === "strength").length, 0);
  // Every artifact is there.
  for (const f of ["verdicts.json", "findings.json", "heatmap.md", "report.md"]) assert.ok(res.files.some((x) => x.endsWith(f)), f);
  const report = readFileSync(path.join(root, "out", "report.md"), "utf8");
  assert.match(report, /\*\*FAIL\*\* — 1 reliability fail\(s\) across 4 conversation\(s\)/);
  const heat = readFileSync(path.join(root, "out", "heatmap.md"), "utf8");
  assert.ok(heat.indexOf("### By behaviour") < heat.indexOf("## Behaviour × fixture"), "margins before the cross");
  assert.ok(heat.indexOf("| concrete_doer |") < heat.indexOf("| strong |"), "the red behaviour sorts first");
});

test("two run directories are repeated samples: a situation's cell becomes a rate", async () => {
  const root = tempRoot();
  const a = writeRun(path.join(root, "a"), [dump("kit-concrete_doer-en", praising, {}, "run-a"), dump("kit-terse-en", clean(), {}, "run-a")]);
  const b = writeRun(path.join(root, "b"), [dump("kit-concrete_doer-en", clean(), {}, "run-b"), dump("kit-terse-en", clean(), {}, "run-b")]);
  const res = await verdictRuns({ dirs: [a, b], outDir: path.join(root, "out") });
  assert.equal(res.conversations.length, 4);
  const heat = readFileSync(path.join(root, "out", "heatmap.md"), "utf8");
  assert.match(heat, /2 runs merged as repeated samples/);
  assert.match(heat, /\| kit-concrete_doer-en \| 2 \| \*\*✗ 1\/2\*\*/);
  assert.match(heat, /no_praise 1\/2/);
  const praise = res.findings.find((f) => f.id === "LC-NO-PRAISE");
  assert.match(praise?.title ?? "", /1 of 4 evaluable/);
});

test("dumps of one situation made by different instruments are refused, naming them", async () => {
  const root = tempRoot();
  const a = writeRun(path.join(root, "a"), [dump("kit-terse-en", clean())]);
  const other = dump("kit-terse-en", clean(), {}, "run-b");
  other.instrument = { ...other.instrument, briefSha: "sha256:different" };
  const b = writeRun(path.join(root, "b"), [other]);
  await assert.rejects(verdictRuns({ dirs: [a, b], outDir: path.join(root, "out") }), (err: unknown) => err instanceof InstrumentIdentityError && /kit-terse-en/.test(err.message) && /sha256:different/.test(err.message));
});

test("the judge cache: reused on a match, re-judged when the dump changes; the interviewer's model is refused as judge", async () => {
  const root = tempRoot();
  const dir = writeRun(path.join(root, "a"), [dump("kit-terse-en", clean()), dump("prep-strong-en", clean())]);
  const judge = fakeJudge();
  await verdictRuns({ dirs: [dir], outDir: path.join(root, "out"), judge });
  assert.equal(judge.calls.length, 2);
  const cached = JSON.parse(readFileSync(path.join(dir, "verdicts", "kit-terse-en.json"), "utf8")) as { judge: { id: string; rubricVersion: string } | null; dumpSha: string };
  assert.equal(cached.judge?.id, "fake-judge");
  assert.match(cached.dumpSha, /^sha256:[0-9a-f]{64}$/);
  await verdictRuns({ dirs: [dir], outDir: path.join(root, "out"), judge });
  assert.equal(judge.calls.length, 2, "a matching (dump, judge, rubric) is not judged again");
  writeFileSync(path.join(dir, "kit-terse-en.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(dir, "kit-terse-en.json"), "utf8")), calls: 99 }));
  await verdictRuns({ dirs: [dir], outDir: path.join(root, "out"), judge });
  assert.equal(judge.calls.length, 3, "a changed dump is re-judged");
  // A rules-only run never overwrites a judged verdict file.
  await verdictRuns({ dirs: [dir], outDir: path.join(root, "out-rules") });
  assert.equal((JSON.parse(readFileSync(path.join(dir, "verdicts", "kit-terse-en.json"), "utf8")) as { judge: unknown }).judge !== null, true);

  const sonnet = dump("kit-terse-en", clean());
  sonnet.trace = { ...sonnet.trace, providers: { interviewer: "claude-cli:sonnet/interviewer", candidate: "claude-cli:sonnet/candidate" } };
  const liveDir = writeRun(path.join(root, "live"), [sonnet]);
  const sameModel = { id: "claude-cli:sonnet", complete: async () => "{}" };
  await assert.rejects(verdictRuns({ dirs: [liveDir], outDir: path.join(root, "out-live"), judge: sameModel }), JudgeIndependenceError);
  const other = await verdictRuns({ dirs: [liveDir], outDir: path.join(root, "out-live"), judge: fakeJudge({ id: "claude-cli:opus" }) });
  assert.equal(other.conversations.length, 1);
});

test("Character voices: a claimed behaviour speaks, cited turns verified; a file without the fields is skipped and says why", async () => {
  const root = tempRoot();
  const dir = writeRun(path.join(root, "a"), [dump("kit-terse-en", clean()), dump("prep-strong-en", clean())]);
  const withFields = path.join(root, "tom-terse.md");
  writeFileSync(withFields, ["---", "name: tom-terse", "character: Tom Terse", "language: en", "sim_behaviours: [terse, minimal]", "---", "", "# Tom", "", "## Conversation criteria", "- I was never pushed for a score.", "- The interviewer narrowed its question when I was brief.", ""].join("\n"));
  const without = path.join(root, "eva.md");
  writeFileSync(without, ["---", "name: eva", "---", "", "# Eva, no criteria here", ""].join("\n"));
  const res = await verdictRuns({ dirs: [dir], outDir: path.join(root, "out"), judge: fakeJudge(), characters: [withFields, without], voiceLlm: fakeCharacterVoice() });
  const tom = res.voices.find((v) => v.character === "tom-terse");
  assert.equal(tom?.status, "ok");
  assert.deepEqual(tom?.refs, ["transcript:run-a/kit-terse-en"]);
  assert.equal(tom?.criteria[0].result, "pass");
  assert.match(tom?.criteria[0].evidence[0] ?? "", /^transcript:run-a\/kit-terse-en#\d+$/);
  assert.equal(tom?.criteria[1].result, "n/a");
  const eva = res.voices.find((v) => v.character === "eva");
  assert.equal(eva?.status, "skipped");
  assert.match(eva?.reason ?? "", /sim_behaviours/);
  const md = readFileSync(path.join(root, "out", "voices", "tom-terse.md"), "utf8");
  assert.match(md, /first-person verdict/);
  assert.ok(res.conversations.find((c) => c.situationId === "kit-terse-en")?.character === "tom-terse", "the finding's character is the Character that claims the behaviour");
});
