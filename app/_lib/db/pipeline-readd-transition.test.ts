// RE-ADD IS A TRANSITION (challenge-r06 db-pipeline-store/A).
//
// createPipelineEntry is idempotent per (candidate, job): a second add lands on the row
// the first one made. Until this change that landing also flipped ANY terminal status
// back to 'active' — with a bare UPDATE, no event, no actor, no status re-assert and no
// transaction. Every other status reversal in the store goes through a guarded, audited
// door (reinstatePipelineEntry, reopenEntriesByJobId, the command-bar restore); this was
// the one that did not, and fourteen callers reach it — the publish-time sourcing loop,
// the automation rematch, the apply and ATS filing core, the devcase doors — so a
// machine could silently undo a human's merit reject, a rematch could leave one person
// live in two funnels, and an ERASED person could come back onto the board.
//
// The rule these cases pin:
//   - a re-add reopens NOTHING unless the caller names a human actor (`reopen.actorRef`);
//   - only a merit/candidate terminal (rejected, declined) is reopenable at all —
//     role_closed reopens through reopenEntriesByJobId, a rematched source through a
//     new funnel, and an anonymized entry never;
//   - a reopen is written with its 'reinstated' event and actor in ONE immediate
//     transaction, and the result says what happened (`reopened`, `reopenRefused`);
//   - the fill-only backfills keep working on a created:false re-add.
//
// Real throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../testing/unit-db.ts";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";

const {
  actOnPipelineEntry,
  anonymizeEntry,
  closeEntriesByJobId,
  createPipelineEntry,
  getPipelineEntry,
  listPipelineEventsForEntry,
  rematchSourceEntry,
} = await import("./pipeline.ts");
const { ensureDb } = await import("./core.ts");
const { DEFAULT_WORKSPACE_ID, createWorkspace } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

let seq = 0;
function pair(prefix = "rt") {
  seq += 1;
  return { candidateId: `${prefix}-c${seq}`, candidateLabel: `Readd Tester ${seq}`, jobId: `${prefix}-job-${seq}`, jobTitle: "Readd Role" };
}
function addFresh(p: ReturnType<typeof pair>, extra: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  const res = createPipelineEntry({ ...p, ...extra });
  assert.equal(res.created, true, "fixture entry should be freshly created");
  return res.entry;
}
const statusOf = (id: string, ws: string = DEFAULT_WORKSPACE_ID) => getPipelineEntry(id, ws)!.status;
const eventCount = (id: string, ws: string = DEFAULT_WORKSPACE_ID) => listPipelineEventsForEntry(id, 200, ws).length;

// ---- 1. no reopen requested → refused, silently nothing -----------------------------

test("a re-add with NO reopen option leaves a rejected entry rejected and writes no event", () => {
  const p = pair();
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");
  const before = eventCount(e.id);

  const res = createPipelineEntry({ ...p });
  assert.equal(res.created, false);
  assert.equal(res.reopened, false);
  assert.equal(res.reopenRefused, "not_requested");
  assert.equal(statusOf(e.id), "rejected", "a machine door never reverses a human reject");
  assert.equal(res.entry.status, "rejected", "the returned entry is the row as it stands");
  assert.equal(eventCount(e.id), before, "no event row for a refusal");
});

test("re-publishing a role (the sourcing loop's call shape) does not revive a merit reject", () => {
  // publish/route.ts files every sourced match with stage 'Accepted' and no reopen.
  const p = pair("pub");
  const e = addFresh(p, { stage: "Accepted" });
  actOnPipelineEntry(e.id, "reject");
  const res = createPipelineEntry({ ...p, stage: "Accepted", matchScore: 91 });
  assert.equal(res.created, false);
  assert.equal(res.reopened, false);
  assert.equal(statusOf(e.id), "rejected");
});

// ---- 2. a named human door reopens, on the record -----------------------------------

test("a re-add naming a human actor reopens a rejected entry with ONE 'reinstated' event carrying the actor", () => {
  const p = pair();
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");
  const stage = getPipelineEntry(e.id)!.stage;
  const before = listPipelineEventsForEntry(e.id, 200).map((ev) => ev.id);

  const res = createPipelineEntry({ ...p, reopen: { actorRef: "human:Petra" } });
  assert.equal(res.created, false);
  assert.equal(res.reopened, true);
  assert.equal(res.reopenRefused, undefined);
  assert.equal(res.entry.status, "active");
  assert.equal(res.entry.stage, stage, "stage is unchanged by a reopen");

  const fresh = listPipelineEventsForEntry(e.id, 200).filter((ev) => !before.includes(ev.id));
  assert.equal(fresh.length, 1, "exactly one new event");
  assert.equal(fresh[0].kind, "reinstated");
  assert.equal(fresh[0].actor, "human:Petra");
  assert.equal(fresh[0].fromStage, stage);
  assert.equal(fresh[0].toStage, stage);
  assert.equal(fresh[0].detail, "reason:readdedByRecruiter");
});

test("a candidate-side decline is reopenable by a human door too", () => {
  const p = pair();
  const e = addFresh(p);
  ensureDb().prepare(`UPDATE pipeline_entries SET status='declined' WHERE id=?`).run(e.id);
  const res = createPipelineEntry({ ...p, reopen: { actorRef: "human:Petra" } });
  assert.equal(res.reopened, true);
  assert.equal(statusOf(e.id), "active");
});

test("a live entry re-added with a reopen option is a plain idempotent re-add: no refusal, no event", () => {
  const p = pair();
  const e = addFresh(p);
  const before = eventCount(e.id);
  const res = createPipelineEntry({ ...p, reopen: { actorRef: "human:Petra" } });
  assert.equal(res.created, false);
  assert.equal(res.reopened, false);
  assert.equal(res.reopenRefused, undefined, "nothing was closed, so nothing was refused");
  assert.equal(eventCount(e.id), before);
});

// ---- 3. non-merit terminals are never reopened by a re-add --------------------------

test("role_closed and rematched entries refuse a requested reopen with 'terminal_status'", () => {
  const closed = pair();
  const c = addFresh(closed);
  closeEntriesByJobId(closed.jobId);
  assert.equal(statusOf(c.id), "role_closed");
  const cBefore = eventCount(c.id);
  const r1 = createPipelineEntry({ ...closed, reopen: { actorRef: "human:Petra" } });
  assert.equal(r1.reopened, false);
  assert.equal(r1.reopenRefused, "terminal_status");
  assert.equal(statusOf(c.id), "role_closed");
  assert.equal(eventCount(c.id), cBefore);

  const src = pair();
  const s = addFresh(src);
  const tgt = addFresh({ ...src, jobId: `${src.jobId}-target` });
  rematchSourceEntry(s.id, tgt.id, tgt.jobId!);
  assert.equal(statusOf(s.id), "rematched");
  const sBefore = eventCount(s.id);
  const r2 = createPipelineEntry({ ...src, reopen: { actorRef: "human:Petra" } });
  assert.equal(r2.reopened, false);
  assert.equal(r2.reopenRefused, "terminal_status");
  assert.equal(statusOf(s.id), "rematched");
  assert.equal(eventCount(s.id), sBefore);
});

// ---- 4. an erased entry never revives -----------------------------------------------

test("an anonymized entry refuses a requested reopen with 'anonymized' and keeps its erasure stamp", () => {
  const p = pair();
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");
  anonymizeEntry(e.id, "erasure");
  const stamp = getPipelineEntry(e.id)!.anonymizedAt;
  assert.ok(stamp);

  const res = createPipelineEntry({ ...p, reopen: { actorRef: "human:Petra" } });
  assert.equal(res.reopened, false);
  assert.equal(res.reopenRefused, "anonymized");
  assert.equal(statusOf(e.id), "rejected");
  assert.equal(getPipelineEntry(e.id)!.anonymizedAt, stamp, "anonymized_at untouched");

  // …and the refusal reason is the same without a reopen request: erasure outranks it.
  assert.equal(createPipelineEntry({ ...p }).reopenRefused, "anonymized");
});

test("an erased entry gets no evidence backfilled onto it (no personal data re-attached)", () => {
  const p = pair();
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");
  anonymizeEntry(e.id, "erasure");
  createPipelineEntry({ ...p, githubHandle: "erased-person", githubJson: JSON.stringify({ login: "erased-person" }) });
  const row = getPipelineEntry(e.id)!;
  assert.equal(row.githubHandle ?? null, null);
  assert.equal(row.githubEvidence ?? null, null);
});

test("ATS re-import landing on an erased, rejected row through the filing core's dedupe never reopens it", async () => {
  const { insertJob } = await import("../job-ingest.ts");
  const { setAtsConnection } = await import("../ats/connections-store.ts");
  const { deleteAtsLinksForEntry } = await import("../ats/links-store.ts");
  const { ingestAtsApplications } = await import("../ats/ingest.ts");
  const W = createWorkspace("Readd ATS team").id;
  const J = "readd-ats-job";
  insertJob({ id: J, title: "Readd ATS role" } as never, undefined, "published", W);
  setAtsConnection({ provider: "recruitee", enabled: true });
  const record = {
    id: 4401,
    candidate: { name: "Ats Erased", emails: ["ats-erased@example.invalid"] },
    stage: { name: "1st round" },
    offer: { id: 55, title: "Vendor title" },
    created_at: "2026-09-01T10:00:00Z",
  };
  const first = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [record] });
  const entryId = first.results[0].entryId!;
  actOnPipelineEntry(entryId, "reject", undefined, undefined, W);
  anonymizeEntry(entryId, "erasure", W);
  deleteAtsLinksForEntry(entryId, W);

  const again = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [record] });
  // Erasure NULLs the applicant_key and the entry id no longer derives from the address
  // (challenge r06 candidate-apply-flow/A), so with the link gone the filing core cannot
  // land on the scrubbed row at all: the vendor record files as a separate entry. What
  // this case forbids is unchanged: the erased row is never reopened or written.
  assert.notEqual(again.results[0].entryId, entryId, "the re-import never lands on the erased row");
  assert.equal(statusOf(entryId, W), "rejected", "the scrubbed row is not flipped back to active");
  assert.equal(getPipelineEntry(entryId, W)?.contact ?? null, null, "the scrubbed row takes no contact backfill");
});

// ---- 5. atomicity: the flip and its audit row commit together ----------------------

test("the reopen flip and its 'reinstated' row commit together; a created add and its 'added' row too", () => {
  const db = ensureDb();
  const p = pair();
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");

  db.exec(`CREATE TEMP TRIGGER readd_abort BEFORE INSERT ON pipeline_events BEGIN SELECT RAISE(ABORT, 'forced'); END;`);
  try {
    assert.throws(() => createPipelineEntry({ ...p, reopen: { actorRef: "human:Petra" } }));
    assert.equal(statusOf(e.id), "rejected", "no un-audited flip survives a failed audit write");

    const fresh = pair();
    assert.throws(() => createPipelineEntry({ ...fresh }));
    const orphan = db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE candidate_id = ?`).get(fresh.candidateId) as { n: number };
    assert.equal(orphan.n, 0, "no entry row without its 'added' event");
  } finally {
    db.exec(`DROP TRIGGER IF EXISTS temp.readd_abort;`);
  }
});

// ---- 6. the rematch door never reverses a merit reject -----------------------------

test("an automated rematch onto a role the candidate was rejected from leaves the target rejected and the source live", async () => {
  const { saveProfile, getProfileRecord } = await import("./profiles.ts");
  const { storePromptCache } = await import("./analyses.ts");
  const { listCorpusJobs } = await import("./jobs.ts");
  const { meterAllows } = await import("../billing/enforce.ts");
  const { computeAutomationCacheKey, computeCorpusFingerprint } = await import("../automation-cache-key.ts");
  const { AUTOMATION_VERSION, runAutomationTask } = await import("../automation-run.ts");
  const ws = DEFAULT_WORKSPACE_ID;

  const { id: candidateId } = saveProfile(
    { label: "Rematch Person", archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["ts"] } },
    ws
  );
  const sourceJob = "readd-rematch-source";
  const targetJob = "readd-rematch-target";
  const target = addFresh({ candidateId, candidateLabel: "Rematch Person", jobId: targetJob, jobTitle: "Target" });
  actOnPipelineEntry(target.id, "reject");
  const source = addFresh({ candidateId, candidateLabel: "Rematch Person", jobId: sourceJob, jobTitle: "Source" });

  const version = AUTOMATION_VERSION.rematch;
  const key = computeAutomationCacheKey({
    version,
    task: "rematch",
    candidateId,
    profileJson: JSON.stringify(getProfileRecord(candidateId, ws)?.payload),
    jobId: sourceJob,
    stage: source.stage,
    notes: "",
    // rematch is a recruiter-narrative (UI_LANG) task: the caller locale is a key axis.
    lang: "en",
    corpusFingerprint: computeCorpusFingerprint(listCorpusJobs(ws).map((j) => j.id)),
    degraded: !meterAllows("ai_candidates", { workspace: ws }),
  });
  storePromptCache(key, { result: { found: true, jobId: targetJob, jobTitle: "Target", score: 88 }, source: "deterministic" }, version, 168);

  const out = await runAutomationTask(source.id, "rematch", "", undefined, "en", ws);
  assert.notEqual(out.applied, "rematched");
  assert.equal(statusOf(target.id), "rejected", "the machine never reverses a merit reject");
  assert.equal(statusOf(source.id), "active", "the source is not closed onto a target that was not reopened");
});

// ---- 7. the recruiter's reconsider door ---------------------------------------------

test("POST /api/pipeline re-add of a rejected candidate reopens it and names the request's human actor", async () => {
  const { POST } = await import("../../api/pipeline/route.ts");
  const p = pair("route");
  const e = addFresh(p);
  actOnPipelineEntry(e.id, "reject");

  const res = await POST(
    new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      body: JSON.stringify({ candidateId: p.candidateId, candidateLabel: p.candidateLabel, jobId: p.jobId, jobTitle: p.jobTitle }),
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reopened: boolean; created: boolean; entry: { status: string } };
  assert.equal(body.created, false);
  assert.equal(body.reopened, true);
  assert.equal(body.entry.status, "active");
  const ev = listPipelineEventsForEntry(e.id, 200).filter((x) => x.kind === "reinstated");
  assert.equal(ev.length, 1);
  // No session in a unit test: humanActor() resolves the honest role token.
  assert.equal(ev[0].actor, "human:recruiter");
});

// ---- 8. fill-only backfills are independent of the reopen decision -------------------

test("fill-only backfills apply on a created:false re-add whether the reopen was not requested, refused or granted", () => {
  const cases: Array<{ status: "rejected" | "role_closed"; reopen?: { actorRef: string } }> = [
    { status: "rejected" },
    { status: "role_closed", reopen: { actorRef: "human:Petra" } },
    { status: "rejected", reopen: { actorRef: "human:Petra" } },
  ];
  for (const c of cases) {
    const p = pair("fill");
    const e = addFresh(p);
    if (c.status === "rejected") actOnPipelineEntry(e.id, "reject");
    else closeEntriesByJobId(p.jobId);
    createPipelineEntry({
      ...p,
      githubJson: JSON.stringify({ login: `gh-${e.id}` }),
      githubHandle: `gh-${seq}`,
      devCaseId: `case-${seq}`,
      devSubmissionId: `sub-${seq}`,
      ...(c.reopen ? { reopen: c.reopen } : {}),
    });
    const row = ensureDb()
      .prepare(`SELECT github_json, github_handle, dev_case_id, dev_submission_id FROM pipeline_entries WHERE id = ?`)
      .get(e.id) as Record<string, string | null>;
    assert.ok(row.github_json, `github_json backfilled (${c.status}, reopen=${!!c.reopen})`);
    assert.equal(row.github_handle, `gh-${seq}`);
    assert.equal(row.dev_case_id, `case-${seq}`);
    assert.equal(row.dev_submission_id, `sub-${seq}`);
  }
});

// ---- the door inventory: only the two recruiter doors may ask for a reopen ----------

test("only POST /api/pipeline and the outreach click pass a reopen option to createPipelineEntry", () => {
  const appDir = fileURLToPath(new URL("../../", import.meta.url));
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(full, "utf8");
        if (src.includes("createPipelineEntry(") && /\breopen:\s*\{\s*actorRef/.test(src)) {
          found.push(path.relative(appDir, full).split(path.sep).join("/"));
        }
      }
    }
  };
  walk(appDir);
  assert.deepEqual(found.sort(), ["api/jobs/[id]/candidates/outreach/route.ts", "api/pipeline/route.ts"]);
});

// ---- the outreach click: a refused reopen sends nothing -----------------------------

test("Reach out on a candidate whose entry on this role stays closed files nothing, drafts nothing, sends nothing", async () => {
  const { insertJob } = await import("../job-ingest.ts");
  const { POST } = await import("../../api/jobs/[id]/candidates/outreach/route.ts");
  const J = "readd-outreach-job";
  insertJob({ id: J, title: "Readd outreach role" } as never, undefined, "published", DEFAULT_WORKSPACE_ID);
  const p = { candidateId: "readd-outreach-c", candidateLabel: "Outreach Closed", jobId: J, jobTitle: "Readd outreach role" };
  const e = addFresh(p, { stage: "Screened" });
  closeEntriesByJobId(J);
  const before = eventCount(e.id);

  const res = await POST(
    new NextRequest(`http://localhost/api/jobs/${J}/candidates/outreach`, {
      method: "POST",
      body: JSON.stringify({ candidateId: p.candidateId, candidateLabel: p.candidateLabel }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: J }) }
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { applied: string; reopened: boolean; reopenRefused: string };
  assert.equal(body.reopened, false);
  assert.equal(body.reopenRefused, "terminal_status");
  assert.equal(body.applied, "suppressed_closed", "the client reads a suppressed* token as 'no message was sent'");
  assert.equal(statusOf(e.id), "role_closed");
  assert.equal(eventCount(e.id), before, "no outreach_sent, no reinstated");
});
