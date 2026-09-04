// The agent-fit transform is the ONE LLM-spend entry in the agents module — the
// runner that turns a job into an AgentFitSpec by spawning
// `pipeline.jobfit.agentfit_cli` — and `grep -rn "runAgentFit" app --include
// '*.test.ts'` was empty before this file. What that silence hid:
//
//   1. `--lang` was never passed. The CLI has accepted it since it shipped
//      (`parser.add_argument("--lang", ..., default="en")`), so every spec — the
//      mission, the system-prompt draft, the coverage rationales — was drafted in
//      English no matter what the workspace speaks, while every other runner here
//      (intake, campaign, devcase, jd-build) threads it.
//   2. Nothing pinned the refusal path: an unknown job, a CLI that dies, a
//      malformed envelope. The workdir cleanup on those paths was equally unheld.
//
// A bogus PYTHON_CMD stands in for the interpreter (the established idiom — see
// reasoning-cache-first.test.ts / group-eval-cohort-run.test.ts), so every spawn
// fails fast with no Python toolchain and no model call. It must be set BEFORE the
// runner is imported, hence the dynamic imports.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";

process.env.PYTHON_CMD = "kp-no-python-for-the-agent-fit-test";

const { agentFitArgs, runAgentFit, toAgentFitEnvelope } = await import("./transform-run.ts");
const { ensureDb } = await import("../db/core.ts");
const { setWorkspaceDefaultLocale } = await import("../db/workspaces.ts");

after(() => cleanupUnitDb());

/** A job row the runner can serialize (getJob reads payload_json). */
function job(id: string): string {
  ensureDb()
    .prepare(
      `INSERT INTO jobs (id, title, payload_json, created_at, workspace_id) VALUES (?, ?, ?, ?, NULL)`
    )
    .run(id, `Role ${id}`, JSON.stringify({ id, title: `Role ${id}`, description: "Ship things." }), new Date().toISOString());
  return id;
}

/** Temp workdirs the runner has left behind (createWorkdir → mkdtemp "jobfit-"). */
// The whole unit suite runs in parallel and every Python spawn mints a `jobfit-*`
// workdir under the SAME os.tmpdir(), so counting that shared root is a race
// (the wave-38d gate saw 5 !== 4 from a sibling suite's spawn). Point the OS temp
// root at a private directory for this process before the first spawn: os.tmpdir()
// re-reads TMP/TEMP/TMPDIR on every call, so the runner's mkdtemp lands here too.
const privateTmp = mkdtempSync(path.join(os.tmpdir(), "agentfit-test-"));
process.env.TMPDIR = privateTmp;
process.env.TMP = privateTmp;
process.env.TEMP = privateTmp;
after(() => rmSync(privateTmp, { recursive: true, force: true }));

function workdirCount(): number {
  return readdirSync(privateTmp, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("jobfit-")).length;
}

test("agentFitArgs threads the workspace's language into the CLI", () => {
  assert.deepEqual(agentFitArgs("/tmp/j.json", "/tmp/c.json", "cs"), [
    "-m",
    "pipeline.jobfit.agentfit_cli",
    "--job-json",
    "/tmp/j.json",
    "--catalog-json",
    "/tmp/c.json",
    "--lang",
    "cs",
  ]);
  // The flag is not decorative: a different locale must actually change the argv,
  // which is the whole defect ("--lang" was absent, so the CLI took its "en" default).
  assert.equal(agentFitArgs("/j", "/c", "de").at(-1), "de");
});

// The runner resolves the locale from the WORKSPACE rather than taking it as a
// required argument, so `tasks.ts` (kind "agent_fit") keeps its three-argument
// call and still stops producing English specs for a Czech tenant. Read as source
// because the spawn itself cannot be observed without a Python toolchain: the
// contract is that these three lines exist and say this.
test("runAgentFit spawns with agentFitArgs and defaults lang to the workspace locale", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  // CRLF-normalised: this checkout carries CRLF while the worktree may not, and a
  // multi-line marker with \n literals then matches in one tree and not the other.
  const src = readFileSync(fileURLToPath(new URL("./transform-run.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  assert.match(
    src,
    /lang: Locale = getWorkspaceDefaultLocale\(workspaceId\)/,
    "the locale must default to the workspace's, not to the CLI's English fallback",
  );
  assert.match(
    src,
    /spawnPython\(agentFitArgs\(jobPath, catalogPath, lang\), \{ signal, env: buildLlmConfigEnv\(\) \}\)/,
    "the spawn must use the argv builder above (and keep buildLlmConfigEnv, which routes BYOM keys)",
  );
  // …and the workspace column the default reads is real and settable, so the
  // default is a live value rather than a name that resolves to the fallback.
  setWorkspaceDefaultLocale("de");
  const { getWorkspaceDefaultLocale } = await import("../db/workspaces.ts");
  assert.equal(getWorkspaceDefaultLocale(), "de");
  setWorkspaceDefaultLocale("cs");
});

test("toAgentFitEnvelope: the parse contract, and what it refuses", () => {
  const good = {
    result: {
      fit: { verdict: "fit", coverage: [], coverageRatio: 0.8 },
      spec: { name: "A", mission: "m", systemPromptDraft: "s", connectors: ["gmail"], maxTurns: null },
      budget: { suggestedMonthlyUsd: 40, rule: "r", salaryBandRef: "b" },
      metrics: [],
    },
  };
  const envelope = toAgentFitEnvelope(good);
  // An envelope with no provenance is DETERMINISTIC, never an unlabelled LLM run:
  // the tab labels a heuristic spec as heuristic, and the wrong default would let
  // a keyless fallback render as a model-authored one.
  assert.equal(envelope.source, "deterministic");
  assert.deepEqual(envelope.perStepSources, {});
  assert.deepEqual(envelope.fallbackReason, {});
  assert.equal(toAgentFitEnvelope({ ...good, source: "llm" }).source, "llm");

  for (const [label, payload] of [
    ["null", null],
    ["no result", {}],
    ["no fit", { result: { spec: good.result.spec, budget: good.result.budget, metrics: [] } }],
    ["metrics not a list", { result: { ...good.result, metrics: "none" } }],
    ["connectors not a list", { result: { ...good.result, spec: { ...good.result.spec, connectors: "gmail" } } }],
  ] as const) {
    assert.throws(() => toAgentFitEnvelope(payload), /unexpected envelope/, `${label} must be refused`);
  }
});

test("runAgentFit refuses an unknown job before it spawns or writes anything", async () => {
  const before = workdirCount();
  await assert.rejects(() => runAgentFit("job-that-does-not-exist"), /job not found: job-that-does-not-exist/);
  assert.equal(workdirCount(), before, "a refused run must not leave a temp workdir behind");
});

test("a CLI that cannot run is a failed run, and the workdir is still cleaned up", async () => {
  const id = job("agentfit-spawn-fail");
  const before = workdirCount();
  // PYTHON_CMD is bogus, so the spawn fails at exec. The contract is that this
  // surfaces as a rejection (the task runner marks the run failed) rather than a
  // half-persisted spec — and that the `finally` still removes the workdir, which
  // is the part a failure path silently skips.
  await assert.rejects(() => runAgentFit(id), (err: unknown) => err instanceof Error);
  assert.equal(workdirCount(), before, "the workdir is removed on the failure path too");

  // …and nothing was persisted for the job: a failed transform leaves no spec.
  const { getLatestAgentFitSpec } = await import("../db/agents.ts");
  assert.equal(getLatestAgentFitSpec(id), null);
});
