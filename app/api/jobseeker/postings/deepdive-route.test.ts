// The deep-dive door's ANSWER SHAPE, keyless and keyed. The page branches on
// { source, fallbackReason, reasoning } (postingView.ts `diveOutcome`), so the three
// shapes are pinned here rather than left to whatever the runner happened to return:
//
//   no provider resolves   → 200 deterministic / no_provider / reasoning null
//   the engine's template  → 200 deterministic / template    / reasoning or null when empty
//   a model answered       → 200 llm           / null        / reasoning, and the row keeps it
//
// NOTHING SPAWNS. The deep-dive's CLI runner is the one seam to the interpreter
// (python-cli.ts) and `defaultDeepDiveDeps.runCli` is where the route resolves it — the
// fake below answers shaped JSON per module, the same way scan.test.ts injects one.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { getJobseekerPosting, setPostingStructure, upsertPosting } from "../../../_lib/db/jobseeker-postings.ts";
import { upsertJobseekerProfile } from "../../../_lib/db/jobseeker-profiles.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { defaultDeepDiveDeps } from "../../../_lib/jobseeker/deepdive.ts";
import type { CliCall, CliRunner } from "../../../_lib/jobseeker/python-cli.ts";
import { PipelineError } from "../../../_lib/python-runner.ts";
import { EMPTY_PREFERENCES, type RawPosting } from "../../../_lib/jobseeker/types.ts";
import { POST as DEEPDIVE } from "./[id]/deepdive/route.ts";

const realRunCli = defaultDeepDiveDeps.runCli;
after(() => {
  defaultDeepDiveDeps.runCli = realRunCli;
  cleanupUnitDb();
});
beforeEach(() => {
  defaultDeepDiveDeps.runCli = realRunCli;
});

const T0 = "2026-09-16T08:00:00.000Z";
let seq = 0;

function raw(): RawPosting {
  seq += 1;
  return {
    externalKey: `dd-${seq}`,
    url: `https://jobs.example/dd-${seq}`,
    title: `Deep-dive posting ${seq}`,
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: "We are hiring. Requirements: TypeScript.",
    jsonld: null,
    lang: "en",
  };
}

upsertJobseekerProfile({ userId: null, profile: { displayName: "Seeker" }, preferences: EMPTY_PREFERENCES });

/** A runner that never spawns: `answers` is keyed by CLI module, and an Error value is
 *  the refusal that module throws. */
function fakeRunner(answers: Record<string, Record<string, unknown> | Error>) {
  const seen: string[] = [];
  const run: CliRunner = async (call: CliCall) => {
    seen.push(call.module);
    const a = answers[call.module];
    if (a instanceof Error) throw a;
    return a ?? {};
  };
  return { run, seen };
}

/** A posting the scan already structured deterministically — the state the deep-dive
 *  door actually meets (a row with no Job at all is a scan ordering bug, not a shape
 *  this route reasons about). */
function structuredPosting(): string {
  const { id } = upsertPosting("src-dd", raw(), T0);
  setPostingStructure(id, { id, title: "Deep-dive posting", requiredSkills: ["TypeScript"] }, "deterministic");
  return id;
}

const dive = (id: string) =>
  DEEPDIVE(new Request(`http://localhost/api/jobseeker/postings/${id}/deepdive`, { method: "POST" }), { params: Promise.resolve({ id }) });

type Body = { source?: string; fallbackReason?: string | null; reasoning?: Record<string, unknown> | null };

test("keyless, no provider: 200 deterministic / no_provider / no rationale, and nothing is stored", async () => {
  const id = structuredPosting();
  const { run, seen } = fakeRunner({
    jobs_cli: new PipelineError({ message: "No LLM provider available for jd_ingest", status: 503 }),
  });
  defaultDeepDiveDeps.runCli = run;

  const res = await dive(id);
  assert.equal(res.status, 200, "keyless is an answer, not a failure");
  const body = (await res.json()) as Body;
  assert.equal(body.source, "deterministic");
  assert.equal(body.fallbackReason, "no_provider");
  assert.equal(body.reasoning, null, "the client must be able to say `no rationale` without guessing");
  assert.deepEqual(seen, ["jobs_cli"], "the refusal ends the deep-dive before the rationale call");
  assert.equal(getJobseekerPosting(id)!.reasoning, null, "a rationale that was never written must not be stored");
});

test("keyless, the engine's template: 200 deterministic / template with the template text, never persisted", async () => {
  const id = structuredPosting();
  const { run, seen } = fakeRunner({
    jobs_cli: { source: "deterministic" },
    reasoning_cli: { source: "deterministic", reasoning: { verdict: "A fixed template verdict.", gaps: ["Kubernetes"] } },
  });
  defaultDeepDiveDeps.runCli = run;

  const body = (await (await dive(id)).json()) as Body;
  assert.equal(body.source, "deterministic");
  assert.equal(body.fallbackReason, "template", "a template is a DIFFERENT honest state from `no model at all`");
  assert.equal(body.reasoning?.verdict, "A fixed template verdict.");
  assert.deepEqual(seen, ["jobs_cli", "reasoning_cli"], "no re-match: the job was not re-structured");
  assert.equal(getJobseekerPosting(id)!.reasoning, null, "a template must not freeze the row out of an upgrade");
});

test("keyless, an EMPTY template: still deterministic / template, with reasoning null rather than {}", async () => {
  const id = structuredPosting();
  const { run } = fakeRunner({ jobs_cli: { source: "deterministic" }, reasoning_cli: { source: "deterministic" } });
  defaultDeepDiveDeps.runCli = run;

  const body = (await (await dive(id)).json()) as Body;
  assert.equal(body.source, "deterministic");
  assert.equal(body.fallbackReason, "template");
  assert.equal(body.reasoning, null, "an empty template answers null: the page shows the note alone, not a blank verdict");
});

test("a model answered: 200 llm / fallbackReason null, and the rationale IS stored", async () => {
  const id = structuredPosting();
  const { run } = fakeRunner({
    jobs_cli: { source: "deterministic" },
    reasoning_cli: { source: "llm", reasoning: { verdict: "Strong overlap on the stack.", strengths: ["TypeScript"] }, narrativeLang: "en" },
  });
  defaultDeepDiveDeps.runCli = run;

  const body = (await (await dive(id)).json()) as Body;
  assert.equal(body.source, "llm");
  assert.equal(body.fallbackReason, null);
  assert.equal(body.reasoning?.verdict, "Strong overlap on the stack.");
  const stored = getJobseekerPosting(id)!.reasoning as Record<string, unknown> | null;
  assert.ok(stored, "a model rationale is persisted — that is what makes the refresh worth doing");
  assert.equal((stored.reasoning as Record<string, unknown>).verdict, "Strong overlap on the stack.");
});

// A content change that lands WHILE the dive is out at the model (a scan re-harvesting
// the posting) nulls job/match/reasoning (upsertPosting). The dive's writes carry the
// content hash it read as a precondition, so nothing computed from the OLD ad is
// stamped over the new one: the row stays unstructured for the next scan to redo.
function changedBody(id: string): void {
  const row = getJobseekerPosting(id)!;
  const outcome = upsertPosting("src-dd", { ...raw(), externalKey: row.externalKey, bodyText: "Completely different role. Requirements: Rust." }, T0);
  assert.equal(outcome.outcome, "changed");
}

test("a content change during model structuring: no job, match or rationale is written over the new ad", async () => {
  const id = structuredPosting();
  const run: CliRunner = async (call: CliCall) => {
    if (call.module === "jobs_cli") {
      changedBody(id);
      return { source: "llm", job: { title: "Old ad, model-structured", requiredSkills: ["TypeScript"] } };
    }
    if (call.module === "match_cli") return { matches: [{ jobId: id, total: 88, fitTier: "strong" }] };
    return { source: "llm", reasoning: { verdict: "About the old ad." } };
  };
  defaultDeepDiveDeps.runCli = run;

  const res = await dive(id);
  assert.equal(res.status, 200);
  const row = getJobseekerPosting(id)!;
  assert.equal(row.job, null, "a Job structured from the OLD ad must not land on the new content");
  assert.equal(row.match, null, "nor a score computed from it");
  assert.equal(row.reasoning, null, "nor a rationale about it");
});

test("a content change during the rationale call: the rationale is not stored on the new ad", async () => {
  const id = structuredPosting();
  const run: CliRunner = async (call: CliCall) => {
    if (call.module === "jobs_cli") return { source: "deterministic" };
    changedBody(id);
    return { source: "llm", reasoning: { verdict: "About the old ad." } };
  };
  defaultDeepDiveDeps.runCli = run;

  await dive(id);
  const row = getJobseekerPosting(id)!;
  assert.equal(row.job, null);
  assert.equal(row.reasoning, null, "a rationale written against a moved content hash is a rationale about another ad");
});

test("the dive reasons with the SESSION user's profile, not whichever profile in the workspace was touched last", async () => {
  // Open mode (unit-db scrubs the password): no session, so the caller is the user-less
  // seeker — the same resolution GET/PUT profile and the dialogs door make. A second
  // seeker's profile in the same workspace, updated more recently, must not be used.
  const other = upsertJobseekerProfile({ userId: "u-other-seeker", profile: { displayName: "Someone else" }, preferences: EMPTY_PREFERENCES });
  ensureDb().prepare(`UPDATE jobseeker_profiles SET updated_at = ? WHERE id = ?`).run("2099-01-01T00:00:00.000Z", other.id);
  const id = structuredPosting();
  let profileSent: unknown = null;
  const run: CliRunner = async (call: CliCall) => {
    if (call.module === "jobs_cli") return { source: "deterministic" };
    profileSent = call.files["profile.json"];
    return { source: "deterministic", reasoning: { verdict: "t" } };
  };
  defaultDeepDiveDeps.runCli = run;

  assert.equal((await dive(id)).status, 200);
  assert.equal((profileSent as { displayName?: string } | null)?.displayName, "Seeker", "the caller's own profile, never the workspace's newest");
});
