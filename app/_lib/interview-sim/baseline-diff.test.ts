// The brief-change DIFF (challenge-r03 interview-simulator/B): `--baseline` classifies every
// situation × invariant cell of a new verdict run against an earlier one — intended
// improvement, non-local regression, non-local improvement, noise, or not comparable
// (registry: conversational-assessment-validation → prompt-change-regression-baseline).
// Pure cases on hand-built verdict rows, then the verdict run and the CLI on hand-built
// dumps in temp directories. No database, no model: the diff is keyless by construction.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { diffVerdicts, renderDiff, type DiffConversation } from "./baseline-diff.ts";
import { buildDump, TEST_AGENDA, type BuildStep } from "./dump-builder.ts";
import type { SimConversationDump } from "./engine.ts";
import { SIM_INVARIANTS, type SimInvariantId } from "./situations.ts";
import type { SimVerdictState } from "./types.ts";
import { verdictRuns } from "./verdict-run.ts";

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
function tempRoot(): string {
  const r = mkdtempSync(path.join(tmpdir(), "kp-sim-diff-"));
  roots.push(r);
  return r;
}

type ConvOpts = { runId?: string; briefSha?: string; directorVersion?: string; situationSha?: string | null };
function conv(situationId: string, states: Partial<Record<SimInvariantId, SimVerdictState>>, o: ConvOpts = {}): DiffConversation {
  return {
    runId: o.runId ?? "run-a",
    situationId,
    situationSha: o.situationSha === undefined ? `sha256:cast-${situationId}` : o.situationSha,
    instrument: { briefSha: o.briefSha ?? "sha256:brief-1", directorVersion: o.directorVersion ?? "sha256:dir-1" },
    judge: null,
    verdicts: (Object.entries(states) as [SimInvariantId, SimVerdictState][]).map(([invariant, state]) => ({
      invariant,
      axis: SIM_INVARIANTS[invariant].axis,
      method: "rule" as const,
      state,
      evidence: state === "fail" ? [{ seq: 4, quote: "what the interviewer said" }] : [],
      note: "",
    })),
  };
}
const NEW = { runId: "run-b", briefSha: "sha256:brief-2" };
const cellOf = (r: ReturnType<typeof diffVerdicts>, situationId: string, invariant: SimInvariantId) => r.cells.find((c) => c.situationId === situationId && c.invariant === invariant);

test("case 1: an untargeted reliability cell that passed and now fails is a BLOCKING non-local regression, with refs from both sides", () => {
  const r = diffVerdicts({ conversations: [conv("kit-terse-en", { no_leak: "pass" })] }, { conversations: [conv("kit-terse-en", { no_leak: "fail" }, NEW)] }, { targets: ["consent_stop"] });
  const c = cellOf(r, "kit-terse-en", "no_leak");
  assert.equal(c?.class, "nonlocal_regression");
  assert.equal(c?.targeted, false);
  assert.equal(r.blocking, true);
  assert.deepEqual(c?.baseline?.refs, ["transcript:run-a/kit-terse-en"]);
  assert.deepEqual(c?.candidate?.refs, ["transcript:run-b/kit-terse-en#4"]);
  assert.equal(r.totals.nonlocal_regression, 1);
});

test("case 2: a targeted cell that failed and now passes is an intended improvement, and blocks nothing", () => {
  const r = diffVerdicts({ conversations: [conv("prep-withdraws_consent-en", { consent_stop: "fail" })] }, { conversations: [conv("prep-withdraws_consent-en", { consent_stop: "pass" }, NEW)] }, { targets: ["consent_stop"] });
  const c = cellOf(r, "prep-withdraws_consent-en", "consent_stop");
  assert.equal(c?.class, "intended_improvement");
  assert.equal(c?.targeted, true);
  assert.equal(r.blocking, false);
  // A situation id is a target too.
  const bySituation = diffVerdicts({ conversations: [conv("prep-withdraws_consent-en", { consent_stop: "fail" })] }, { conversations: [conv("prep-withdraws_consent-en", { consent_stop: "pass" }, NEW)] }, { targets: ["prep-withdraws_consent-en"] });
  assert.equal(cellOf(bySituation, "prep-withdraws_consent-en", "consent_stop")?.class, "intended_improvement");
});

test("case 3: a flip inside the baseline's own observed spread is noise, never a regression", () => {
  const baseline = [conv("kit-terse-en", { no_leak: "fail" }), conv("kit-terse-en", { no_leak: "pass" }, { runId: "run-a2" }), conv("kit-terse-en", { no_leak: "pass" }, { runId: "run-a3" })];
  const r = diffVerdicts({ conversations: baseline }, { conversations: [conv("kit-terse-en", { no_leak: "fail" }, NEW)] }, { targets: [] });
  const c = cellOf(r, "kit-terse-en", "no_leak");
  assert.equal(c?.class, "noise");
  assert.deepEqual([c?.baseline?.fail, c?.baseline?.evaluable, c?.candidate?.fail, c?.candidate?.evaluable], [1, 3, 1, 1]);
  assert.equal(r.blocking, false);
  assert.equal(r.totals.nonlocal_regression, 0);
  // A baseline that never flipped has no spread: the same candidate is a real regression.
  const pure = [conv("kit-terse-en", { no_leak: "pass" }), conv("kit-terse-en", { no_leak: "pass" }, { runId: "run-a2" }), conv("kit-terse-en", { no_leak: "pass" }, { runId: "run-a3" })];
  assert.equal(cellOf(diffVerdicts({ conversations: pure }, { conversations: [conv("kit-terse-en", { no_leak: "fail" }, NEW)] }, { targets: [] }), "kit-terse-en", "no_leak")?.class, "nonlocal_regression");
});

test("case 4: a side that could not evaluate the cell makes it not comparable, counted in neither regressions nor improvements", () => {
  for (const state of ["not_evaluable", "not_provoked"] as const) {
    const r = diffVerdicts({ conversations: [conv("kit-terse-en", { no_leak: "pass" })] }, { conversations: [conv("kit-terse-en", { no_leak: state }, NEW)] }, { targets: [] });
    const c = cellOf(r, "kit-terse-en", "no_leak");
    assert.equal(c?.class, "not_comparable", state);
    assert.match(c?.reason ?? "", new RegExp(state));
    assert.equal(r.totals.nonlocal_regression + r.totals.targeted_regression + r.totals.intended_improvement + r.totals.nonlocal_improvement, 0);
    assert.equal(r.blocking, false);
  }
});

test("case 5: a situation whose cast changed is not comparable in every cell, and the headline names it", () => {
  const r = diffVerdicts(
    { conversations: [conv("kit-terse-en", { no_leak: "pass", no_decision: "pass" }), conv("kit-strong-cs", { no_leak: "pass" })] },
    { conversations: [conv("kit-terse-en", { no_leak: "fail", no_decision: "fail" }, { ...NEW, situationSha: "sha256:edited-persona" }), conv("kit-strong-cs", { no_leak: "pass" }, NEW)] },
    { targets: [] },
  );
  for (const inv of ["no_leak", "no_decision"] as const) {
    const c = cellOf(r, "kit-terse-en", inv);
    assert.equal(c?.class, "not_comparable", inv);
    assert.equal(c?.reason, "cast changed");
  }
  assert.equal(r.blocking, false, "an edited persona is not a regression of the instrument");
  assert.deepEqual(r.castChanged, ["kit-terse-en"]);
  assert.ok(r.headline.some((l) => /cast changed/.test(l) && /kit-terse-en/.test(l)), r.headline.join("\n"));
  // A dump from before situationSha existed: the cast is unknown, never assumed equal.
  const old = diffVerdicts({ conversations: [conv("kit-terse-en", { no_leak: "pass" }, { situationSha: null })] }, { conversations: [conv("kit-terse-en", { no_leak: "fail" }, NEW)] }, { targets: [] });
  assert.equal(cellOf(old, "kit-terse-en", "no_leak")?.reason, "cast unknown");
});

test("case 6: the same instrument on both sides is a spread measurement: no cell can be an intended improvement or block", () => {
  const r = diffVerdicts(
    { conversations: [conv("prep-withdraws_consent-en", { consent_stop: "fail", no_leak: "pass" })] },
    { conversations: [conv("prep-withdraws_consent-en", { consent_stop: "pass", no_leak: "fail" }, { runId: "run-b" })] },
    { targets: ["consent_stop"] },
  );
  assert.equal(r.instrumentChanged, false);
  assert.ok(r.headline.some((l) => l.includes("no instrument change: this is a spread measurement")), r.headline.join("\n"));
  assert.equal(r.totals.intended_improvement, 0);
  assert.equal(cellOf(r, "prep-withdraws_consent-en", "consent_stop")?.class, "noise");
  assert.equal(cellOf(r, "prep-withdraws_consent-en", "no_leak")?.class, "noise");
  assert.equal(r.blocking, false);
  // diff.md leads with non-local regressions, then intended, noise, not comparable.
  const changed = diffVerdicts(
    { conversations: [conv("kit-terse-en", { no_leak: "pass", consent_stop: "fail", no_decision: "pass" }), conv("kit-strong-cs", { no_leak: "pass" })] },
    { conversations: [conv("kit-terse-en", { no_leak: "fail", consent_stop: "pass", no_decision: "not_evaluable" }, NEW), conv("kit-strong-cs", { no_leak: "pass" }, NEW)] },
    { targets: ["consent_stop"] },
  );
  const md = renderDiff(changed);
  const at = (h: string) => md.indexOf(h);
  assert.ok(at("## Non-local regressions") > 0 && at("## Non-local regressions") < at("## Intended improvements"), md);
  assert.ok(at("## Intended improvements") < at("## Noise") && at("## Noise") < at("## Not comparable"), md);
  assert.match(md, /BLOCKING/);
});

// ---- the verdict run and the CLI ------------------------------------------------------------

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

function writeRun(dir: string, dumps: SimConversationDump[]): string {
  mkdirSync(path.join(dir, "instruments"), { recursive: true });
  for (const d of dumps) writeFileSync(path.join(dir, `${d.situationId}.json`), `${JSON.stringify(d, null, 2)}\n`);
  for (const sha of new Set(dumps.map((d) => d.instrument.briefSha))) {
    writeFileSync(
      path.join(dir, "instruments", `kit.en-${sha.replace(/\W/g, "").slice(0, 12)}.json`),
      JSON.stringify({ key: "kit.en", fixture: "kit", locale: "en", agenda: TEST_AGENDA, privateBrief: "Ask one question.", candidateBrief: "Ask one question.", record: { briefSha: sha, agendaBlockIds: TEST_AGENDA.blocks.map((b) => b.id), directorVersion: "sha256:dir" } }),
    );
  }
  writeFileSync(path.join(dir, "index.json"), JSON.stringify({ version: 1, runs: [{ runId: dumps[0]?.runId ?? "run" }], conversations: dumps.map((d) => ({ situationId: d.situationId, file: `${d.situationId}.json` })) }));
  return dir;
}
function dump(situationId: string, steps: BuildStep[], runId: string, briefSha: string): SimConversationDump {
  const d = buildDump(steps, { situationId, runId });
  return { ...d, situationSha: `sha256:cast-${situationId}`, instrument: { ...d.instrument, briefSha } };
}
function twoRuns(root: string): { oldDir: string; newDir: string } {
  const oldDir = writeRun(path.join(root, "old"), [dump("kit-terse-en", clean(), "run-a", "sha256:brief-1"), dump("prep-strong-en", clean(), "run-a", "sha256:brief-1")]);
  const newDir = writeRun(path.join(root, "new"), [dump("kit-terse-en", praising, "run-b", "sha256:brief-2"), dump("prep-strong-en", clean(), "run-b", "sha256:brief-2")]);
  return { oldDir, newDir };
}

test("case 8a: verdictRuns with a baseline writes diff.json and diff.md beside report.md; without one it writes neither", async () => {
  const root = tempRoot();
  const { oldDir, newDir } = twoRuns(root);
  await verdictRuns({ dirs: [oldDir] });
  const plain = await verdictRuns({ dirs: [newDir], outDir: path.join(root, "plain") });
  assert.ok(!plain.files.some((f) => /diff\.(md|json)$/.test(f)));
  assert.ok(!existsSync(path.join(root, "plain", "diff.json")) && !existsSync(path.join(root, "plain", "diff.md")));

  const res = await verdictRuns({ dirs: [newDir], outDir: path.join(root, "cmp"), baseline: { dir: path.join(oldDir, "verdict"), targets: ["consent_stop"] } });
  for (const f of ["report.md", "diff.md", "diff.json"]) assert.ok(existsSync(path.join(root, "cmp", f)), f);
  const diff = JSON.parse(readFileSync(path.join(root, "cmp", "diff.json"), "utf8")) as ReturnType<typeof diffVerdicts>;
  assert.equal(diff.blocking, true);
  const praise = diff.cells.find((c) => c.situationId === "kit-terse-en" && c.invariant === "no_praise");
  assert.equal(praise?.class, "nonlocal_regression");
  assert.ok(praise?.candidate?.refs.some((r) => r.startsWith("transcript:run-b/kit-terse-en#")));
  assert.equal(res.diff?.blocking, true);
  // The dump's cast digest is carried onto the verdict row the next diff reads.
  const verdicts = JSON.parse(readFileSync(path.join(root, "cmp", "verdicts.json"), "utf8")) as { conversations: { situationSha: string | null }[] };
  assert.ok(verdicts.conversations.every((c) => c.situationSha?.startsWith("sha256:cast-")));
});

test("case 8b: the CLI takes --baseline and --targets, writes the diff, and refuses --targets alone", () => {
  const root = tempRoot();
  const { oldDir, newDir } = twoRuns(root);
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "scripts/interview-sim-verdict.ts", ...args], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, KP_OFFLINE: "1" } });
  assert.equal(cli(["--runs", oldDir]).status, 0);
  const plain = cli(["--runs", newDir, "--out", path.join(root, "plain")]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!existsSync(path.join(root, "plain", "diff.md")), "without --baseline nothing new is written");
  const cmp = cli(["--runs", newDir, "--out", path.join(root, "cmp"), "--baseline", path.join(oldDir, "verdict"), "--targets", "consent_stop"]);
  assert.equal(cmp.status, 0, `a regression is a RESULT, not a CLI error\n${cmp.stderr}`);
  assert.ok(existsSync(path.join(root, "cmp", "diff.md")) && existsSync(path.join(root, "cmp", "diff.json")));
  assert.match(cmp.stdout, /BLOCKING/);
  const lonely = cli(["--runs", newDir, "--out", path.join(root, "x"), "--targets", "consent_stop"]);
  assert.equal(lonely.status, 2);
  assert.match(lonely.stderr, /--targets needs --baseline/);
});
