// The human scorecard route files one record per (interviewer, round) — r09
// schedule-interview-prep/A. Before this, POST replaced the single
// `payload.humanScorecard` key, so a second interviewer (or a second round in a
// workspace that split its Interview column) erased the first record, and the form
// opened pre-filled with the first interviewer's verdict.
//
// Driven through the REAL handlers with real signed sessions (the pattern of
// app/api/decisions/feedback-letters/feedback-letters.test.ts): two principals on one
// team, a third on another team, and open mode (no operator password, no identity).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-panel-scorecards";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpPanelScorecardCookie?: () => string | null }).__kpPanelScorecardCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpPanelScorecardCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const PASSWORD = "panel-scorecards-password";
process.env.KP_SECRET = "panel-scorecards-secret";
process.env.KP_OPERATOR_PASSWORD = PASSWORD;

const { GET, POST } = await import("./route.ts");
const { saveInterviewPrep, getInterviewPrep, getHumanScorecard, getHumanScorecards, listPreparedEntries } = await import(
  "../../../_lib/interview-prep.ts"
);
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-panel-scorecards";
const team = createWorkspace("Panel team", ORG);
const other = createWorkspace("Other panel team", ORG);
const member = (slug: string, name: string, ws: string) => {
  const u = createUser({ orgId: ORG, email: `panel.${slug}@panel.test`, name, status: "active", password: `panel-pw-${slug}-1` });
  upsertMembership(u.id, ws, "recruiter");
  return { ...u, ws };
};
const u1 = member("u1", "Ivana First", team.id);
const u2 = member("u2", "Otakar Second", team.id);
const outsider = member("out", "Olga Outside", other.id);

function signedInAs(user: { id: string; orgId: string; ws: string } | null): void {
  cookieValue = user === null ? null : signSession(user.ws, Date.now(), { sub: user.id, org: user.orgId });
}

let seq = 0;
function prepped(ws?: string, stage = "Interview"): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `panel-c${seq}`,
    candidateLabel: `Panel Candidate ${seq}`,
    jobId: `panel-job-${seq}`,
    jobTitle: "Panel Role",
    stage,
    ...(ws ? { workspaceId: ws } : {}),
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "panel" });
  return entry.id;
}

function url(entryId: string): URL {
  return new URL(`http://localhost/api/interview-prep/scorecard?entry=${encodeURIComponent(entryId)}`);
}

async function post(entryId: string, rating: number, summary: string): Promise<Response> {
  return (await POST({
    nextUrl: url(entryId),
    headers: new Headers(),
    json: async () => ({ ratings: [{ competency: "Ownership", rating, evidence: summary }], summary }),
  } as never)) as unknown as Response;
}

async function get(entryId: string): Promise<Response> {
  return (await GET({ nextUrl: url(entryId), headers: new Headers() } as never)) as unknown as Response;
}

type Rec = { author: string | null; authorLabel: string | null; stage: string | null; summary?: string; savedAt: string | null };

test("two interviewers on one entry keep two records; the headline mirror is the latest save", async () => {
  const id = prepped(team.id);
  signedInAs(u1);
  assert.equal((await post(id, 4, "u1 verdict")).status, 200);
  signedInAs(u2);
  assert.equal((await post(id, 2, "u2 verdict")).status, 200);

  const records = getHumanScorecards(id, team.id) as Rec[];
  assert.equal(records.length, 2, "u2's save did not erase u1's");
  assert.deepEqual(
    records.map((r) => [r.author, r.authorLabel, r.summary]),
    [
      [u1.id, "Ivana First", "u1 verdict"],
      [u2.id, "Otakar Second", "u2 verdict"],
    ],
  );
  const payload = getInterviewPrep(id, team.id)?.payload as { humanScorecard?: Rec };
  assert.equal(payload.humanScorecard?.summary, "u2 verdict", "payload.humanScorecard mirrors the latest save");
  assert.equal(getHumanScorecard(id)?.summary, "u2 verdict");
  assert.equal(listPreparedEntries([id], team.id)[id]?.hasHumanScorecard, true);
});

test("GET answers the caller's own record only as `mine`; another team gets 404", async () => {
  const id = prepped(team.id);
  signedInAs(u1);
  assert.equal((await post(id, 5, "only u1")).status, 200);

  signedInAs(u2);
  const res = await get(id);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { mine: Rec | null; records: Rec[] };
  assert.equal(body.mine, null, "a second interviewer's form opens EMPTY");
  assert.deepEqual(
    body.records.map((r) => r.author),
    [u1.id],
  );

  signedInAs(u1);
  const own = (await (await get(id)).json()) as { mine: Rec | null };
  assert.equal(own.mine?.summary, "only u1");

  signedInAs(outsider);
  const foreign = await get(id);
  assert.equal(foreign.status, 404);
  assert.equal(((await foreign.json()) as { code?: string }).code, "INTERVIEW_PREP_NOT_FOUND");
});

test("open mode keeps today's one slot per stage, and a new round is a new record", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  signedInAs(null);
  try {
    const id = prepped(undefined, "Interview");
    assert.equal((await post(id, 3, "first")).status, 200);
    assert.equal((await post(id, 4, "second")).status, 200);
    let records = getHumanScorecards(id) as Rec[];
    assert.equal(records.length, 1, "same stage, no identity: the one slot is replaced");
    assert.equal(records[0].summary, "second");

    ensureDb().prepare(`UPDATE pipeline_entries SET stage = ? WHERE id = ?`).run("Interview 2", id);
    assert.equal((await post(id, 2, "round two")).status, 200);
    records = getHumanScorecards(id) as Rec[];
    assert.equal(records.length, 2, "round 2 does not overwrite round 1");
    assert.deepEqual(
      records.map((r) => [r.stage, r.summary]),
      [
        ["Interview", "second"],
        ["Interview 2", "round two"],
      ],
    );
  } finally {
    process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  }
});
