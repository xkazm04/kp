// The kit REHEARSAL door, driven through the REAL handler (spark interview-kit-template,
// WP-D): POST /api/jobs/[id]/interview-kit/rehearse { kitId } -> { url }.
//
// What is pinned here, and why it has to be driven rather than read:
//   - the ORDER of the refusals is a property of which one a request meets — a viewer
//     asking about a job that does not exist must meet the capability refusal, not learn
//     the job is missing; an unconfigured server must refuse before a session exists;
//   - "a draft is rehearsable" and "the version named is the version pinned" are facts
//     about the row the door writes, not about its source;
//   - the reservation is sized from the kit's own booked length, which only a real
//     billing state can show is the WORST case and not the typical one.
//
// Signed sessions, not open mode: with KP_OPERATOR_PASSWORD set the caller's seat and
// team come from the cookie, so "minted in the CALLER's workspace" is proven against a
// team that is not the default one. next/headers is resolved to a virtual module whose
// jar this file drives (the write-capability-gate.test.ts harness).
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import type { InterviewKit } from "../../../../../_lib/interview-kit-types.ts";

register(new URL("../../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-rehearse";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpRehearseCookie?: () => string | null }).__kpRehearseCookie = () => cookieValue;
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
            const value = globalThis.__kpRehearseCookie();
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

process.env.KP_SECRET = "rehearse-route-secret";
process.env.KP_OPERATOR_PASSWORD = "rehearse-route-password";
// Per-test limiter buckets: with a trusted hop the x-forwarded-for below IS the key, so
// one test's mints never spend another test's budget.
process.env.KP_TRUSTED_PROXY = "1";
// Deterministic voice config: exactly OpenAI configured, nothing self-hosted, no
// onboarding preference leaking in from a developer's shell.
for (const k of ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_BASE_URL", "KP_VOICE_PROVIDER"]) delete process.env[k];
process.env.OPENAI_API_KEY = "sk-rehearse-unit";

const { POST } = await import("./route.ts");
const { ensureDb } = await import("../../../../../_lib/db/core.ts");
const { createWorkspace } = await import("../../../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../../../_lib/db/memberships.ts");
const { signSession, DEMO_WORKSPACE } = await import("../../../../../_lib/auth/session.ts");
const { interviewKitAppendVersion, interviewKitById } = await import("../../../../../_lib/db/interview-kits.ts");
const { getInterviewSessionByToken } = await import("../../../../../_lib/db/interviews.ts");
const { upsertBillingState } = await import("../../../../../_lib/db/billing.ts");
const { recordMeterUsage, meterOverview, entitledPlan } = await import("../../../../../_lib/billing/entitlements.ts");
const { getBillingState } = await import("../../../../../_lib/db/billing.ts");

after(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

// ---- fixtures -----------------------------------------------------------------------

const ORG = "org-rehearse";
const team = createWorkspace("Rehearse team", ORG);
const OTHER_WS = createWorkspace("Other team", "org-rehearse-other").id;

function member(ws: string, org: string, slug: string, role: "owner" | "viewer") {
  const u = createUser({ orgId: org, email: `rh.${slug}@rehearse.test`, name: `Rh ${slug}`, status: "active", password: `rh-pw-${slug}-1` });
  upsertMembership(u.id, ws, role);
  return { id: u.id, orgId: org, ws };
}
const owner = member(team.id, ORG, "owner", "owner");
const viewer = member(team.id, ORG, "viewer", "viewer");

function signedInAs(user: { id: string; orgId: string; ws: string } | null): void {
  cookieValue = user === null ? null : signSession(user.ws, Date.now(), { sub: user.id, org: user.orgId });
}

/** A job row owned by `ws` — SQL, so the fixture states exactly one thing: who owns it. */
function seedJob(id: string, ws: string | null): string {
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, 'published', ?, ?)`)
    .run(id, "Backend Engineer", JSON.stringify({ id, title: "Backend Engineer", requirements: [] }), ws, new Date().toISOString());
  return id;
}

const KIT: InterviewKit = {
  version: 1,
  competencies: [
    {
      id: "c-own",
      title: "Service ownership",
      weight: 3,
      budgetMin: 8,
      questions: [{ id: "q-own", text: "Walk me through a service you owned end to end.", mustAsk: true }],
    },
    {
      id: "c-inc",
      title: "Incident response",
      weight: 2,
      budgetMin: 4,
      questions: [{ id: "q-inc", text: "Tell me about the last incident you led.", mustAsk: false }],
    },
  ],
  faq: [],
};
/** The kit's planned length: max(GROUNDED_DEFAULT_MIN 20, 1 warm-up + 12 + 2 + 2). */
const KIT_PLANNED_MIN = 20;

function kitFor(jobId: string, ws: string, status: "draft" | "published" = "draft", title = "Service ownership") {
  const kit: InterviewKit = { ...KIT, competencies: [{ ...KIT.competencies[0], title }, KIT.competencies[1]] };
  return interviewKitAppendVersion({ jobId, kit, source: "edited", status }, ws);
}

const sessionCount = () => (ensureDb().prepare(`SELECT COUNT(*) AS n FROM interview_sessions`).get() as { n: number }).n;

let ipSeq = 0;
function rehearse(jobId: string, body: unknown, ip = `10.1.0.${(ipSeq += 1)}`): Promise<Response> {
  const req = new Request(`http://localhost/api/jobs/${jobId}/interview-kit/rehearse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(req, { params: Promise.resolve({ id: jobId }) });
}

async function code(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

// ---- authority first ----------------------------------------------------------------

test("a viewer is refused FORBIDDEN_CAPABILITY — before the door reveals whether the job exists — and nothing is minted", async () => {
  const jobId = seedJob("rh-viewer-job", team.id);
  const kit = kitFor(jobId, team.id);
  const before = sessionCount();
  signedInAs(viewer);
  for (const target of [jobId, "rh-no-such-job"]) {
    const res = await rehearse(target, { kitId: kit.id });
    assert.equal(res.status, 403, `a viewer must not rehearse (${target})`);
    const body = (await res.json()) as { code?: string; capability?: string };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY");
    assert.equal(body.capability, "pipeline:write");
  }
  signedInAs(null);
  assert.equal((await rehearse(jobId, { kitId: kit.id })).status, 401, "no session at all is a 401");
  // An anonymous public-demo cookie is a valid signature but never an operator: this
  // door spends real voice minutes, so it must not be reachable from the demo sandbox.
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  assert.equal((await rehearse(jobId, { kitId: kit.id })).status, 401, "a demo cookie is refused");
  assert.equal(sessionCount(), before, "a refused seat mints nothing");
});

// ---- the mint -----------------------------------------------------------------------

test("a DRAFT kit is rehearsable: the door mints a test session with no entry, pinned to that version, in the caller's team", async () => {
  const jobId = seedJob("rh-draft-job", team.id);
  const draft = kitFor(jobId, team.id, "draft");
  signedInAs(owner);
  const res = await rehearse(jobId, { kitId: draft.id });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["url"], "the answer is exactly { url } — the contract WP-C's button reads");
  const url = body.url as string;
  assert.match(url, /^\/interview\/[A-Za-z0-9_-]+$/, "a same-origin portal path, unpinned to a language");

  const session = getInterviewSessionByToken(url.slice("/interview/".length));
  assert.ok(session, "the url resolves to the minted session");
  assert.equal(session.mode, "test", "a rehearsal is never a candidate-mode session");
  assert.equal(session.entryId, null, "no candidate is attached");
  assert.equal(session.candidateLabel, null);
  assert.equal(session.kitId, draft.id, "pinned to the version the body named — a draft");
  assert.equal(session.jobId, jobId);
  assert.equal(session.workspaceId, team.id, "stamped with the CALLER's team, not the default one");
  assert.equal(session.status, "created");
  assert.equal(session.durationMin, KIT_PLANNED_MIN, "booked for the kit's own planned length");
  assert.equal(session.language, "en", "the recruiter's language (no cookie here → the default locale)");
  assert.equal(session.consentAt, null);
  // The rail the portal paints before /connect answers: the agenda's candidate-safe
  // titles, in agenda order — the kit's competencies between the fixed opening and close.
  assert.deepEqual(
    session.runOfShow,
    ["Warm-up", "Service ownership", "Incident response", "Your questions about the role", "Wrap-up"],
    "the kit-only agenda's own titles"
  );
  // The fallback snapshot carries NO director protocol: it runs only when /connect cannot
  // rebuild the kit, and then no tools ride with it.
  assert.ok(session.instructions && !/Director protocol/.test(session.instructions), "the stored fallback brief describes no tools");

  // Rehearsing is not publishing.
  assert.equal(interviewKitById(draft.id, team.id)?.status, "draft", "the draft stays a draft");
});

test("the version NAMED is the version pinned — an older published version rehearses as itself", async () => {
  const jobId = seedJob("rh-versions-job", team.id);
  const v1 = kitFor(jobId, team.id, "published", "First spine");
  const v2 = kitFor(jobId, team.id, "published", "Second spine");
  signedInAs(owner);
  for (const [kit, title] of [
    [v1, "First spine"],
    [v2, "Second spine"],
  ] as const) {
    const res = await rehearse(jobId, { kitId: kit.id });
    assert.equal(res.status, 200);
    const session = getInterviewSessionByToken(((await res.json()) as { url: string }).url.slice("/interview/".length));
    assert.equal(session?.kitId, kit.id);
    assert.ok(session?.runOfShow?.includes(title), `the rail is ${title}'s, not the latest version's`);
  }
});

// ---- 404s: invisible job, foreign or wrong kit --------------------------------------

test("an invisible job is JOB_NOT_FOUND and a kit that is not this job's is INTERVIEW_KIT_NOT_FOUND — nothing minted", async () => {
  const mine = seedJob("rh-mine", team.id);
  const sibling = seedJob("rh-sibling", team.id);
  const foreign = seedJob("rh-foreign", OTHER_WS);
  const siblingKit = kitFor(sibling, team.id);
  const theirKit = kitFor(foreign, OTHER_WS);
  // Another team's kit filed under a job id THIS team can see — the workspace-bound read
  // must refuse it even when the job re-assertion alone would not.
  const theirKitOnMyJob = kitFor(mine, OTHER_WS);
  const before = sessionCount();
  signedInAs(owner);

  for (const [label, jobId, body, expected] of [
    ["unknown job", "rh-no-such-job", { kitId: siblingKit.id }, "JOB_NOT_FOUND"],
    ["another team's job", foreign, { kitId: theirKit.id }, "JOB_NOT_FOUND"],
    ["another ROLE's kit", mine, { kitId: siblingKit.id }, "INTERVIEW_KIT_NOT_FOUND"],
    ["another TEAM's kit", mine, { kitId: theirKit.id }, "INTERVIEW_KIT_NOT_FOUND"],
    ["another team's kit on my job id", mine, { kitId: theirKitOnMyJob.id }, "INTERVIEW_KIT_NOT_FOUND"],
    ["unknown kit", mine, { kitId: "ikit-nope" }, "INTERVIEW_KIT_NOT_FOUND"],
    ["no kitId", mine, {}, "INTERVIEW_KIT_NOT_FOUND"],
    ["blank kitId", mine, { kitId: "   " }, "INTERVIEW_KIT_NOT_FOUND"],
    ["non-string kitId", mine, { kitId: 42 }, "INTERVIEW_KIT_NOT_FOUND"],
    ["oversized kitId", mine, { kitId: "x".repeat(200) }, "INTERVIEW_KIT_NOT_FOUND"],
    ["unparseable body", mine, "{not json", "INTERVIEW_KIT_NOT_FOUND"],
  ] as const) {
    const res = await rehearse(jobId, body);
    assert.equal(res.status, 404, `${label} must 404`);
    assert.equal(await code(res), expected, `${label} answers ${expected}`);
  }
  assert.equal(sessionCount(), before, "no refusal minted a session");
});

test("a body past the cap is PAYLOAD_TOO_LARGE, coded", async () => {
  const jobId = seedJob("rh-big-body", team.id);
  signedInAs(owner);
  const res = await rehearse(jobId, { kitId: "k", pad: "x".repeat(8 * 1024) });
  assert.equal(res.status, 413);
  assert.equal(await code(res), "PAYLOAD_TOO_LARGE");
});

// ---- keyless -------------------------------------------------------------------------

test("with no voice provider configured the door refuses INTERVIEW_PROVIDER_UNCONFIGURED before anything exists", async () => {
  const jobId = seedJob("rh-keyless", team.id);
  const kit = kitFor(jobId, team.id);
  const before = sessionCount();
  signedInAs(owner);
  delete process.env.OPENAI_API_KEY;
  try {
    const res = await rehearse(jobId, { kitId: kit.id });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string; provider?: string; need?: string[] };
    assert.equal(body.code, "INTERVIEW_PROVIDER_UNCONFIGURED", "the code /connect itself answers");
    assert.equal(body.provider, "openai");
    assert.deepEqual(body.need, ["OPENAI_API_KEY"], "the operator learns which env var is missing, as data");
    assert.equal(sessionCount(), before, "a keyless install mints nothing");
  } finally {
    process.env.OPENAI_API_KEY = "sk-rehearse-unit";
  }
});

// ---- billing: reserved like /simulate ------------------------------------------------

test("the reservation is the WORST case /complete can debit — 2x the booked length — on the caller's own org", async () => {
  // A second, metered org, so the default-org tests above stay unmetered.
  const PAID_ORG = "org-rehearse-paid";
  const paidTeam = createWorkspace("Paid team", PAID_ORG);
  const paidOwner = member(paidTeam.id, PAID_ORG, "paid-owner", "owner");
  const jobId = seedJob("rh-paid-job", paidTeam.id);
  const kit = kitFor(jobId, paidTeam.id);
  upsertBillingState({ orgId: PAID_ORG, plan: "growth", status: "active", provider: "polar", currentPeriodEnd: "2999-12-31T00:00:00Z" });
  const remaining = () => meterOverview("interview_minutes", entitledPlan(getBillingState(PAID_ORG), new Date()), new Date(), PAID_ORG).remaining as number;
  const worstCase = KIT_PLANNED_MIN * 2;

  // Exactly the worst case left: admitted. Minting reserves nothing durable — the debit
  // happens at /complete — so the balance is unchanged afterwards.
  recordMeterUsage("interview_minutes", remaining() - worstCase, new Date(), paidTeam.id);
  assert.equal(remaining(), worstCase);
  signedInAs(paidOwner);
  const ok = await rehearse(jobId, { kitId: kit.id });
  assert.equal(ok.status, 200, "a meter that covers the worst case admits the rehearsal");
  assert.equal(remaining(), worstCase, "the mint itself debits nothing");

  // One minute short of the worst case: refused, coded, and nothing minted — a booked
  // 20-minute rehearsal can bill 40, so a meter with 39 left must not start it.
  recordMeterUsage("interview_minutes", 1, new Date(), paidTeam.id);
  const before = sessionCount();
  const refused = await rehearse(jobId, { kitId: kit.id });
  assert.equal(refused.status, 402);
  const body = (await refused.json()) as { code?: string; meter?: string; plan?: string };
  assert.equal(body.code, "BILLING_QUOTA_EXCEEDED");
  assert.equal(body.meter, "interview_minutes");
  assert.equal(body.plan, "growth");
  assert.equal(sessionCount(), before, "a 402 mints nothing");
});

// ---- the throttle --------------------------------------------------------------------

test("the door is throttled per caller at 20 per 10 minutes, after every refusal and before the mint", async () => {
  const jobId = seedJob("rh-throttle", team.id);
  const kit = kitFor(jobId, team.id);
  signedInAs(owner);
  const IP = "10.9.9.9";
  // A refused call spends no budget: twenty 404s first, then twenty admitted mints.
  for (let i = 0; i < 20; i += 1) assert.equal((await rehearse(jobId, { kitId: "ikit-nope" }, IP)).status, 404);
  const before = sessionCount();
  for (let i = 0; i < 20; i += 1) assert.equal((await rehearse(jobId, { kitId: kit.id }, IP)).status, 200, `mint ${i + 1} is inside the budget`);
  const throttled = await rehearse(jobId, { kitId: kit.id }, IP);
  assert.equal(throttled.status, 429);
  assert.equal(await code(throttled), "TOO_MANY_REQUESTS");
  assert.equal(sessionCount(), before + 20, "the throttled call minted nothing");
});
