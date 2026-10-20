// The `gig_report` runner on an isolated DB, over a FAKE report CLI and a temp gigs root:
// the keyless path (kp's body), the model path, `current` (no rewrite) and `force`, the
// `writing` mark, a suspect gig that never reaches the model, a failed write, the second pass
// when the gig moved on during the call, and setGigReport's tenancy. No Python, no model.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "../../db/workspaces.ts";
import { createManualGig, getGig, setGigBrief, setGigReport, transitionGig } from "../../db/gigs.ts";
import { acceptGigPlan, createGigPlanRound, setGigPlanResult } from "../../db/gigs-plans.ts";
import type { CliCall } from "../../jobseeker/python-cli.ts";
import { REPORT_FIXTURE_BRIEF } from "../__fixtures__/report-facts.ts";
import type { GigReport } from "../types.ts";
import { previousReportPath } from "./file.ts";
import { parseGigReportTaskParams, runGigReport, type GigReportRunDeps } from "./run.ts";

const WS = DEFAULT_WORKSPACE_ID;
const ROOT = mkdtempSync(path.join(tmpdir(), "kp-report-run-"));

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  cleanupUnitDb();
});

let seq = 0;
function gig(opts: { brief?: boolean } = {}): string {
  seq += 1;
  const { gig: g } = createManualGig(WS, {
    arena: "freelance",
    url: `https://example.test/report-run/${seq}`,
    title: `Checkout page too slow ${seq}`,
    bodyText: `Make the checkout faster (${seq}).`,
    org: "Kleinbäckerei GmbH",
    reward: { amount: 1800, currency: "EUR", text: "€1,800" },
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  if (opts.brief !== false) setGigBrief(WS, g.id, { ...REPORT_FIXTURE_BRIEF, createdAt: new Date().toISOString() });
  return g.id;
}

const MODEL_RESULT = {
  lead: "Take it: the brief rates it very hard but the reward is fair.",
  highlight: "the reward is fair",
  sections: ["gig", "asks", "risks", "fit", "questions"].map((kind) => ({ id: kind, title: `About ${kind}`, kind, html: `<p>${kind} section.</p><script>x</script>` })),
};

type Fake = { calls: CliCall[]; deps: Partial<GigReportRunDeps> };
function fake(answer: (call: CliCall) => Record<string, unknown> | Promise<Record<string, unknown>>, over: Partial<GigReportRunDeps> = {}): Fake {
  const calls: CliCall[] = [];
  return {
    calls,
    deps: {
      runCli: async (call) => {
        calls.push(call);
        return answer(call);
      },
      reportsRoot: () => ROOT,
      log: () => {},
      ...over,
    },
  };
}

const KEYLESS = () => ({ result: null, source: "deterministic", fallbackReason: "no_provider", promptVersion: "gig-report-v1", costUsd: null });
const LLM = () => ({ result: MODEL_RESULT, source: "llm", fallbackReason: null, promptVersion: "gig-report-v1", costUsd: 0.19 });

test("keyless: kp writes the whole report itself, the record says deterministic + no_provider", async () => {
  const id = gig();
  const f = fake(KEYLESS);
  const out = await runGigReport(WS, id, { deps: f.deps });
  assert.equal(out.status, "written");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].module, "gig_report_cli");
  assert.equal(f.calls[0].llm, true);
  const input = f.calls[0].files["input.json"] as { stage: string; facts: { gig: { id: string } } };
  assert.equal(input.stage, "researched");
  assert.equal(input.facts.gig.id, id);
  const report = getGig(WS, id)!.report!;
  assert.deepEqual([report.status, report.stage, report.source, report.model, report.fallbackReason, report.costUsd], ["ready", "researched", "deterministic", null, "no_provider", null]);
  assert.ok(report.path.startsWith(ROOT) && report.path.includes(`${path.sep}web${path.sep}`), report.path);
  const html = readFileSync(report.path, "utf8");
  assert.match(html, /Written by kp from its own facts, with no model/);
  assert.match(html, /What to ask the client/);
});

test("the model path: sanitized sections, the CLI's cost recorded; an up-to-date report is `current`, `force` rewrites", async () => {
  const id = gig();
  const f = fake(LLM);
  assert.equal((await runGigReport(WS, id, { deps: f.deps })).status, "written");
  const first = getGig(WS, id)!.report!;
  assert.deepEqual([first.source, first.model, first.costUsd], ["llm", "claude-sonnet-5-5", 0.19]);
  const html = readFileSync(first.path, "utf8");
  assert.match(html, /<mark>the reward is fair<\/mark>/);
  assert.doesNotMatch(html, /<script>x/);

  const again = await runGigReport(WS, id, { deps: f.deps });
  assert.equal(again.status, "current");
  assert.equal(again.costUsd, null, "nothing was spent");
  assert.equal(f.calls.length, 1);

  const forced = await runGigReport(WS, id, { force: true, deps: f.deps });
  assert.equal(forced.status, "written");
  assert.equal(f.calls.length, 2);
  assert.ok(existsSync(previousReportPath(first.path)), "the previous version is kept");
});

test("while it runs the record says `writing`; a failed write says `failed` and keeps the previous file", async () => {
  const id = gig();
  let seen: GigReport["status"] | undefined;
  const f = fake(() => {
    seen = getGig(WS, id)!.report?.status;
    return KEYLESS();
  });
  await runGigReport(WS, id, { deps: f.deps });
  assert.equal(seen, "writing");
  const before = getGig(WS, id)!.report!;

  const broken = fake(KEYLESS, { writeFile: () => { throw new Error("disk full"); } });
  const out = await runGigReport(WS, id, { force: true, deps: broken.deps });
  assert.equal(out.status, "failed");
  const after = getGig(WS, id)!.report!;
  assert.deepEqual([after.status, after.fallbackReason, after.path], ["failed", "write_failed", before.path]);
  assert.ok(existsSync(before.path));
});

test("a suspect gig never reaches the model; no brief means no report", async () => {
  const id = gig();
  assert.ok(transitionGig(WS, id, { from: "new", to: "suspect" }).ok);
  const f = fake(LLM);
  const out = await runGigReport(WS, id, { deps: f.deps });
  assert.equal(f.calls.length, 0);
  assert.deepEqual([out.status, out.source, out.fallbackReason], ["written", "deterministic", "gig_suspect"]);

  const bare = gig({ brief: false });
  assert.deepEqual([(await runGigReport(WS, bare, { deps: fake(LLM).deps })).status, getGig(WS, bare)!.report], ["skipped", null]);
  assert.equal((await runGigReport(WS, "gig-nope", { deps: fake(LLM).deps })).reason, "not_found");
});

test("a gig that moved to a later stage during the call gets a second pass at that stage", async () => {
  const id = gig();
  const rows = createGigPlanRound(WS, id, [{ seat: "sonnet", model: "claude-sonnet-5-5", effort: "high" }])!;
  const plan = {
    summary: "Profile, then defer.",
    steps: [1, 2, 3, 4].map((n) => ({ title: `Step ${n}`, doneWhen: `Result ${n} exists.` })),
    decisions: [],
    risks: [],
    effortHours: { min: 10, max: 20 },
    questions: [],
  };
  assert.ok(setGigPlanResult(WS, rows[0].id, { plan, fallbackReason: null, costUsd: 0.2, durationMs: 1 }));
  const stages: string[] = [];
  const f = fake((call) => {
    stages.push((call.files["input.json"] as { stage: string }).stage);
    // The operator accepts the plan while the planned report is being written.
    if (stages.length === 1) assert.ok(acceptGigPlan(WS, rows[0].id, "go").ok);
    return KEYLESS();
  });
  const out = await runGigReport(WS, id, { deps: f.deps });
  assert.deepEqual(stages, ["planned", "accepted"]);
  assert.equal(out.stage, "accepted");
  assert.equal(getGig(WS, id)!.report!.stage, "accepted");
});

test("setGigReport is scoped to the workspace and does not touch updated_at", () => {
  const id = gig();
  const before = getGig(WS, id)!;
  const report: GigReport = { path: path.join(ROOT, "x.html"), stage: "researched", status: "ready", source: "deterministic", model: null, fallbackReason: null, costUsd: null, generatedAt: "2026-09-30T00:00:00.000Z" };
  assert.equal(setGigReport("ws-other", id, report), null);
  assert.equal(getGig(WS, id)!.report, null);
  const stored = setGigReport(WS, id, report)!;
  assert.deepEqual(stored.report, report);
  assert.equal(stored.updatedAt, before.updatedAt);
});

test("task params: a gig id is required; force and a known stage ride along", () => {
  assert.equal(parseGigReportTaskParams({}), null);
  assert.deepEqual(parseGigReportTaskParams({ gigId: "g1", force: true, stage: "drafted" }), { gigId: "g1", force: true, stage: "drafted" });
  assert.deepEqual(parseGigReportTaskParams({ gigId: "g1", force: "yes", stage: "bogus" }), { gigId: "g1", force: false, stage: null });
});
