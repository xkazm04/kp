// The TS half of the kit generator (interview-kit-run.ts) — everything that can be pinned
// without spawning Python, which `npm run test:unit` (a Node-only CI job) must not do.
//
// The Python half — the prompt, the keyless `deterministic()` kit, the coercer — is pinned
// in pipeline/jobfit/tests/test_interview_kit.py. The one thing neither side can prove
// alone is that they AGREE: that what Python emits on the keyless path is something the TS
// boundary accepts rather than refuses. The split is deliberate: the third test below
// feeds a SNAPSHOT of that output through the TS normalizer (so a TS change that starts
// refusing it goes red here), and the Python suite asserts the TS contract's own limits —
// weights in 1..3, a positive whole-minute budget, a question per competency, the
// must-ask cap — against EVERY kit its deterministic and coerced paths produce (so a
// Python change that would be refused goes red there).
//
// unit-db.ts MUST be the first project import (the runner module reaches the stores).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { RoleBrief } from "./rolespec.ts";

const { interviewKitArgs, kitBriefProjection, toInterviewKitEnvelope } = await import("./interview-kit-run.ts");
const { normalizeInterviewKit } = await import("./interview-kit-validate.ts");
const { interviewKitAppendVersion, interviewKitLatestDraft, interviewKitLatestPublished } = await import("./db/interview-kits.ts");

after(() => cleanupUnitDb());

test("the CLI argv names the job, the language, and the brief ONLY when there is one", () => {
  const withBrief = interviewKitArgs("/w/job.json", "/w/brief.json", "cs");
  assert.deepEqual(withBrief.slice(0, 3), ["-m", "pipeline.jobfit.automation_cli", "interview-kit"]);
  assert.ok(withBrief.includes("--brief-json"));
  assert.equal(withBrief[withBrief.indexOf("--lang") + 1], "cs", "a Czech tenant must not get an English kit");

  // "No brief" and "an empty brief" must not look the same to the prompt, so the flag is
  // omitted rather than pointed at an empty file.
  const withoutBrief = interviewKitArgs("/w/job.json", null, "en");
  assert.equal(withoutBrief.includes("--brief-json"), false);
});

test("the envelope parse accepts the CLI's shape and refuses anything without competencies", () => {
  const parsed = toInterviewKitEnvelope({ result: { competencies: [], faq: [] }, source: "llm" });
  assert.equal(parsed.source, "llm");
  // An absent source is reported as the keyless path, never as the model's: claiming a
  // model wrote a template is the green lie this repo's provenance rules forbid.
  assert.equal(toInterviewKitEnvelope({ result: { competencies: [] } }).source, "deterministic");
  for (const bad of [null, {}, { result: null }, { result: { competencies: "nope" } }, { result: { faq: [] } }]) {
    assert.throws(() => toInterviewKitEnvelope(bad), /unexpected envelope/, `must refuse ${JSON.stringify(bad)}`);
  }
});

test("what Python emits on the KEYLESS path is a kit the TS boundary accepts, unrefused", () => {
  // A snapshot of `automation.interview_kit(job, None, provider=None)` for a role with two
  // must-haves, one nice-to-have and two detected skills (the BACKEND fixture in
  // test_interview_kit.py). A keyless install must never generate a kit its own store
  // then refuses; see the header for which half of that each suite holds.
  const keyless = {
    result: {
      competencies: [
        { title: "Go", weight: 3, budgetMin: 10, questions: [
          { text: "Walk me through a concrete piece of work where you used Go. What was your exact part in it?", mustAsk: true, followUp: "Who else was involved, and which decisions were yours?" },
          { text: "On that same work, what went wrong around Go, and what did you change because of it?", mustAsk: false, followUp: "What would you do differently if you started it again today?" },
        ] },
        { title: "PostgreSQL", weight: 3, budgetMin: 10, questions: [
          { text: "Walk me through a concrete piece of work where you used PostgreSQL. What was your exact part in it?", mustAsk: true, followUp: "Who else was involved, and which decisions were yours?" },
          { text: "On that same work, what went wrong around PostgreSQL, and what did you change because of it?", mustAsk: false, followUp: "What would you do differently if you started it again today?" },
        ] },
        { title: "Kafka", weight: 2, budgetMin: 10, questions: [
          { text: "Walk me through a concrete piece of work where you used Kafka. What was your exact part in it?", mustAsk: false, followUp: "Who else was involved, and which decisions were yours?" },
          { text: "On that same work, what went wrong around Kafka, and what did you change because of it?", mustAsk: false, followUp: "What would you do differently if you started it again today?" },
        ] },
        { title: "Docker", weight: 1, budgetMin: 10, questions: [
          { text: "Walk me through a concrete piece of work where you used Docker. What was your exact part in it?", mustAsk: false, followUp: "Who else was involved, and which decisions were yours?" },
          { text: "On that same work, what went wrong around Docker, and what did you change because of it?", mustAsk: false, followUp: "What would you do differently if you started it again today?" },
        ] },
        { title: "Kubernetes", weight: 1, budgetMin: 10, questions: [
          { text: "Walk me through a concrete piece of work where you used Kubernetes. What was your exact part in it?", mustAsk: false, followUp: "Who else was involved, and which decisions were yours?" },
          { text: "On that same work, what went wrong around Kubernetes, and what did you change because of it?", mustAsk: false, followUp: "What would you do differently if you started it again today?" },
        ] },
      ],
      faq: [
        { question: "Where is this role based?", answer: "Brno (hybrid)" },
        { question: "Which languages does the team work in?", answer: "cs, en" },
      ],
      promptVersion: "interview-kit-v1",
    },
    source: "deterministic",
  };

  const envelope = toInterviewKitEnvelope(keyless);
  const normalized = normalizeInterviewKit(envelope.result);
  assert.equal(normalized.ok, true, `the keyless kit was refused: ${normalized.ok ? "" : normalized.reason}`);
  if (!normalized.ok) throw new Error("unreachable");
  // Python emits no ids (the store owns them), so minting is the ONE expected repair.
  assert.deepEqual(normalized.adjusted, ["ids_minted"], "the keyless kit must need no repair beyond ids");
  assert.equal(normalized.kit.competencies.length, 5);
  assert.equal(normalized.kit.faq.length, 2);

  // …and it lands exactly the way runInterviewKit files it: a DRAFT, source generated,
  // never auto-published. A machine's kit must not become what candidates are asked
  // without a human saying so.
  const saved = interviewKitAppendVersion({ jobId: "keyless-job", kit: normalized.kit, source: "generated", status: "draft" });
  assert.equal(saved.status, "draft");
  assert.equal(saved.source, "generated");
  assert.equal(interviewKitLatestDraft("keyless-job")?.id, saved.id);
  assert.equal(interviewKitLatestPublished("keyless-job"), null, "a generated kit is never the live one on its own");
});

test("the runner only ever writes a DRAFT — publishing is not in its vocabulary", async () => {
  // Source guard for the property the previous test drives on the store: the runner's own
  // append must name status "draft", and it must never call the publish flip.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./interview-kit-run.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(src, /interviewKitAppendVersion\(\s*\{[^}]*source: "generated", status: "draft"/);
  assert.equal(/interviewKitPublish\s*\(/.test(src), false, "the generator must never publish its own kit");
});

test("the runner refuses a role this team cannot see — BEFORE it spends anything", async () => {
  // POST /api/tasks starts any known kind with client-supplied params, so the route's
  // ownership gate is not the only way in. The runner asserts ownership itself; this
  // drive never reaches the spawn (the check precedes the workdir), which is also why it
  // can run in the Node-only unit job.
  const { runInterviewKit } = await import("./interview-kit-run.ts");
  const { ensureDb } = await import("./db/core.ts");
  const { DEFAULT_WORKSPACE_ID } = await import("./db/workspaces.ts");
  const { interviewKitVersions } = await import("./db/interview-kits.ts");
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, 'published', ?, ?)`)
    .run("kit-run-foreign", "Their private role", JSON.stringify({ id: "kit-run-foreign", title: "Their private role" }), "team-beta", new Date().toISOString());

  await assert.rejects(runInterviewKit("kit-run-foreign", undefined, DEFAULT_WORKSPACE_ID, "en"), /job not found/);
  await assert.rejects(runInterviewKit("kit-run-no-such-job", undefined, DEFAULT_WORKSPACE_ID, "en"), /job not found/);
  assert.deepEqual(interviewKitVersions("kit-run-foreign", DEFAULT_WORKSPACE_ID), [], "a refused run writes nothing");
});

test("the brief projection keeps the requestor's own words and drops intake bookkeeping", () => {
  assert.equal(kitBriefProjection(null), null, "no brief is no brief, not an empty object");
  assert.equal(
    kitBriefProjection({ summary: "", responsibilities: [], successCriteria: [], requirements: [], facets: [] } as RoleBrief),
    null,
    "an empty brief says nothing and must not reach the prompt looking like a brief"
  );

  const projected = kitBriefProjection({
    summary: "Own payments reliability.",
    responsibilities: ["Run the on-call rotation", "  "],
    successCriteria: ["Zero P1 incidents in 90 days"],
    requirements: [
      { skill: "Go", kind: "must_have", hardness: "prerequisite", weight: 1, rationale: "private note", provenance: "turn 3", confidence: 0.9 },
      { skill: "Kafka", kind: "nice_to_have", hardness: "learnable", weight: 0.5, rationale: "", provenance: "", confidence: 0.4 },
    ],
    facets: [],
  } as unknown as RoleBrief);
  assert.ok(projected);
  assert.equal(projected.summary, "Own payments reliability.");
  assert.deepEqual(projected.responsibilities, ["Run the on-call rotation"]);
  assert.ok((projected.dealbreakers as string[]).includes("Go"), "a must-have is a dealbreaker the kit must probe");
  assert.equal((projected.dealbreakers as string[]).includes("Kafka"), false, "a nice-to-have is not a dealbreaker");
  assert.equal(JSON.stringify(projected).includes("private note"), false, "intake rationale never reaches the prompt");
  assert.equal(JSON.stringify(projected).includes("turn 3"), false, "…nor its provenance bookkeeping");
});
