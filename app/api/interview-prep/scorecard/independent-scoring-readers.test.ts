// Independent scoring holds at EVERY reader of the human scorecard panel, not just the
// scorecard GET (council craft-1/craft-2). Real handlers, real signed sessions: a second
// interviewer who has not filed gets no colleague's record, verdict or user id from the
// prep read, the candidate drawer, the compare grid or the role view; after filing they
// see the colleagues'; a team:manage caller sees them without filing; and the store still
// holds (and the gate still counts) every record. A zero-rating POST is refused and opens
// nothing. unit-db.ts must stay the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-independent-readers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpIndepCookie?: () => string | null }).__kpIndepCookie = () => cookieValue;
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
            const value = globalThis.__kpIndepCookie();
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

process.env.KP_SECRET = "independent-readers-secret";
process.env.KP_OPERATOR_PASSWORD = "independent-readers-password";

const scorecard = await import("./route.ts");
const prepRoute = await import("../route.ts");
const compareRoute = await import("../../interview/compare/route.ts");
const timelineRoute = await import("../../pipeline/[id]/timeline/route.ts");
const roleViewRoute = await import("../../decisions/role-view/route.ts");
const { getHumanScorecards, saveHumanScorecard, saveInterviewPrep } = await import("../../../_lib/interview-prep.ts");
const { createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-independent-readers";
const team = createWorkspace("Independent readers team", ORG);
const member = (slug: string, name: string, role: "recruiter" | "admin") => {
  const u = createUser({ orgId: ORG, email: `indep.${slug}@indep.test`, name, status: "active", password: `indep-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return { ...u, ws: team.id };
};
const u1 = member("u1", "Ivana First", "recruiter");
const u2 = member("u2", "Otakar Second", "recruiter");
const admin = member("adm", "Alena Admin", "admin");

function signedInAs(user: { id: string; orgId: string; ws: string }): void {
  cookieValue = signSession(user.ws, Date.now(), { sub: user.id, org: user.orgId });
}

const JOB = "indep-job-1";
let seq = 0;
function entryWithPanel(): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `indep-c-${seq}`,
    candidateLabel: `Independent Candidate ${seq}`,
    jobId: JOB,
    jobTitle: "Independent Role",
    stage: "Interview",
    workspaceId: team.id,
  });
  saveInterviewPrep(entry.id, entry.candidateLabel, entry.jobTitle, { scenario: "indep" });
  return entry.id;
}

function urlFor(path: string, q: string): URL {
  return new URL(`http://localhost${path}?${q}`);
}

async function file(entryId: string, body: unknown): Promise<Response> {
  const url = urlFor("/api/interview-prep/scorecard", `entry=${encodeURIComponent(entryId)}`);
  const req = Object.assign(new Request(url, { method: "POST", body: JSON.stringify(body) }), { nextUrl: url });
  return (await scorecard.POST(req as never)) as unknown as Response;
}
const rated = (summary: string, rating = 4) => ({
  ratings: [{ competency: "Ownership", rating, evidence: summary }],
  summary,
  recommendation: "advance",
});

async function prepRead(entryId: string): Promise<{ prep: { payload: Record<string, unknown> } | null }> {
  const url = urlFor("/api/interview-prep", `entry=${encodeURIComponent(entryId)}`);
  return (await ((await prepRoute.GET({ nextUrl: url, headers: new Headers() } as never)) as unknown as Response).json()) as never;
}
async function drawer(entryId: string): Promise<{ humanScorecards: { summary?: string }[] }> {
  const res = (await timelineRoute.GET(new Request(`http://localhost/api/pipeline/${entryId}/timeline`) as never, {
    params: Promise.resolve({ id: entryId }),
  } as never)) as unknown as Response;
  assert.equal(res.status, 200);
  return (await res.json()) as never;
}
async function compare(): Promise<{ candidates: { entryId: string; humanScorecards: { summary?: string }[] }[] }> {
  const url = urlFor("/api/interview/compare", `job=${JOB}`);
  return (await ((await compareRoute.GET({ nextUrl: url, headers: new Headers() } as never)) as unknown as Response).json()) as never;
}
async function roleView(): Promise<{ candidates: { entryId: string; interview: { human: { count: number } } }[] }> {
  const res = (await roleViewRoute.GET(new Request(`http://localhost/api/decisions/role-view?job=${JOB}`) as never)) as unknown as Response;
  assert.equal(res.status, 200);
  return (await res.json()) as never;
}

async function readAll(entryId: string) {
  const prep = await prepRead(entryId);
  const d = await drawer(entryId);
  const c = await compare();
  const rv = await roleView();
  const list = (prep.prep?.payload.humanScorecards as { summary?: string }[] | undefined) ?? [];
  return {
    prepSummaries: list.map((r) => r.summary ?? ""),
    prepHeadline: "humanScorecard" in (prep.prep?.payload ?? {}),
    drawer: d.humanScorecards.map((r) => r.summary ?? ""),
    compare: (c.candidates.find((x) => x.entryId === entryId)?.humanScorecards ?? []).map((r) => r.summary ?? ""),
    roleCount: rv.candidates.find((x) => x.entryId === entryId)?.interview.human.count,
    wire: JSON.stringify([prep, d, c, rv]),
  };
}

test("every reader: a second interviewer who has not filed gets no colleague's record, verdict or user id", async () => {
  const id = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(id, rated("u1 private verdict"))).status, 200);

  signedInAs(u2);
  const r = await readAll(id);
  assert.deepEqual(r.prepSummaries, [], "prep read: panel withheld");
  assert.equal(r.prepHeadline, false, "prep read: the headline mirror is withheld too");
  assert.deepEqual(r.drawer, [], "candidate drawer");
  assert.deepEqual(r.compare, [], "compare grid");
  assert.equal(r.roleCount, 0, "role view carries no colleague's rating");
  assert.equal(r.wire.includes("u1 private verdict"), false);
  assert.equal(r.wire.includes(u1.id), false, "no user id anywhere");

  // the gate/seal side still reads the FULL set
  assert.equal(getHumanScorecards(id, team.id).length, 1, "the store (and so the gate) still counts the colleague's record");
});

test("every reader: after filing the caller sees the colleagues' records, never with a user id", async () => {
  const id = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(id, rated("u1 verdict"))).status, 200);
  signedInAs(u2);
  assert.equal((await file(id, rated("u2 verdict", 2))).status, 200);

  const r = await readAll(id);
  assert.deepEqual([...r.prepSummaries].sort(), ["u1 verdict", "u2 verdict"]);
  assert.deepEqual([...r.drawer].sort(), ["u1 verdict", "u2 verdict"]);
  assert.deepEqual([...r.compare].sort(), ["u1 verdict", "u2 verdict"]);
  assert.equal(r.roleCount, 2);
  assert.equal(r.wire.includes(u1.id) || r.wire.includes(u2.id), false, "no user id on any reader");
  assert.equal(getHumanScorecards(id, team.id).length, 2);
});

test("every reader: a team:manage caller sees the records without filing", async () => {
  const id = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(id, rated("u1 for the admin"))).status, 200);
  signedInAs(admin);
  const r = await readAll(id);
  assert.deepEqual(r.prepSummaries, ["u1 for the admin"]);
  assert.deepEqual(r.drawer, ["u1 for the admin"]);
  assert.deepEqual(r.compare, ["u1 for the admin"]);
  assert.equal(r.roleCount, 1);
  assert.equal(r.wire.includes(u1.id), false);
});

test("the cohort views apply the rule per entry: filing for one candidate opens only that candidate", async () => {
  const a = entryWithPanel();
  const b = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(a, rated("u1 on a"))).status, 200);
  assert.equal((await file(b, rated("u1 on b"))).status, 200);
  signedInAs(u2);
  assert.equal((await file(a, rated("u2 on a"))).status, 200);

  const c = await compare();
  const cards = (id: string) => (c.candidates.find((x) => x.entryId === id)?.humanScorecards ?? []).map((r) => r.summary).sort();
  assert.deepEqual(cards(a), ["u1 on a", "u2 on a"]);
  assert.deepEqual(cards(b), [], "u2 has not filed on b");
  assert.ok(c.candidates.some((x) => x.entryId === b), "b stays in the cohort: a card exists");
  const rv = await roleView();
  assert.equal(rv.candidates.find((x) => x.entryId === a)?.interview.human.count, 2);
  assert.equal(rv.candidates.find((x) => x.entryId === b)?.interview.human.count, 0);
});

test("a zero-rating POST is refused with a code and does not open the reveal", async () => {
  const id = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(id, rated("u1 colleague verdict"))).status, 200);

  signedInAs(u2);
  for (const body of [{ ratings: [], summary: "nothing rated" }, { summary: "no ratings key" }, { ratings: [{ competency: "Ownership", rating: "n/a" }] }]) {
    const res = await file(id, body);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code?: string }).code, "INTERVIEW_SCORECARD_RATINGS_REQUIRED");
  }
  assert.equal(getHumanScorecards(id, team.id).length, 1, "nothing was filed");
  const r = await readAll(id);
  assert.deepEqual(r.prepSummaries, []);
  assert.deepEqual(r.compare, []);

  const url = urlFor("/api/interview-prep/scorecard", `entry=${encodeURIComponent(id)}`);
  const got = (await ((await scorecard.GET({ nextUrl: url, headers: new Headers() } as never)) as unknown as Response).json()) as {
    records: unknown[];
    othersCount: number;
  };
  assert.deepEqual(got.records, []);
  assert.equal(got.othersCount, 1);
});

test("an existing stored zero-rating record does not open the reveal, and is not rewritten", async () => {
  const id = entryWithPanel();
  signedInAs(u1);
  assert.equal((await file(id, rated("u1 real verdict"))).status, 200);
  saveHumanScorecard(id, { ratings: [], summary: "legacy empty", source: "human" }, { author: u2.id, authorLabel: "Otakar Second", stage: "Interview" });

  signedInAs(u2);
  const r = await readAll(id);
  assert.deepEqual(r.compare, [], "an empty card from before the refusal does not count as filed");
  assert.deepEqual(r.drawer, []);
  assert.equal(getHumanScorecards(id, team.id).length, 2, "the stored record is left as it was");
});
