// GET /api/devcase/[id]/channels - the assignment detail's own postings read
// (challenge-r09 devcase-lifecycle/A).
//
// The detail reader used to receive the WORKSPACE's postings fold (every posting, every
// submission, every outcome join and promote verdict) and filter it to one case in the
// browser. It now reads its own case's channels by id, scoped in SQL, through the same
// enrichment the workspace route answers with - and a case id from another workspace
// answers exactly what GET /api/devcase/[id] answers for it (no existence oracle).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `currentWorkspace()` reads the session cookie through next/headers, which cannot run
// outside a Next request scope - so the jar is driven from here.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpDevcaseChannelsCookie?: () => string | null }).__kpDevcaseChannelsCookie = () => cookieValue;
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
            const value = globalThis.__kpDevcaseChannelsCookie();
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

// Open mode (no KP_OPERATOR_PASSWORD): identity folds to owner, so what is under test is
// the TENANT the read is scoped to.
process.env.KP_SECRET = "devcase-channels-secret";

const { GET } = await import("./route.ts");
const { GET: GET_CASE } = await import("../route.ts");
const { GET: GET_POSTINGS } = await import("../../postings/route.ts");
const { saveDevCase, createPosting, createSubmission, saveSubmissionEvaluation, startDevSession } = await import("../../../../_lib/db/devcase.ts");
const { recordOutcome } = await import("../../../../_lib/dev-outcomes.ts");
const { createWorkspace } = await import("../../../../_lib/db/workspaces.ts");
const { signSession } = await import("../../../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const mine = createWorkspace("Channels team", "org-channels-mine");
const theirs = createWorkspace("Other channels team", "org-channels-theirs");
const design = { need: { title: "Ledger" }, analysis: null, role: { title: "Payments engineer" }, case: { title: "Refund ledger" } };
const ownId = saveDevCase(design, mine.id).id;
const otherOwnId = saveDevCase({ ...design, case: { title: "Another" } }, mine.id).id;
const foreignId = saveDevCase({ ...design, case: { title: "Their case" } }, theirs.id).id;

const posting = createPosting({ caseId: ownId, channel: "careers", token: "tok-channels-own", roleTitle: "Payments engineer", caseTitle: "Refund ledger" });
createPosting({ caseId: otherOwnId, channel: "careers", token: "tok-channels-other", roleTitle: null, caseTitle: null });
createPosting({ caseId: foreignId, channel: "careers", token: "tok-channels-foreign", roleTitle: null, caseTitle: null });
const { submission } = createSubmission({ postingId: posting.id, candidateRef: "Eva", repoRef: "repo-eva" });
saveSubmissionEvaluation(
  submission.id,
  {
    evaluation: { summary: "ok", strengths: [], concerns: [], confidence: 0.8 },
    transfer: { transferScore: 77, roleFitRationale: "fit" },
    authenticity: { band: "clean", score: 88 },
  },
  77,
);
recordOutcome({ ref: submission.id, candidateRef: "Eva", outcome: "pending" }, mine.id);
startDevSession({ token: "tok-channels-own", candidateRef: "mid-case" });

const call = (id: string) =>
  GET(new Request(`http://localhost/api/devcase/${id}/channels`), { params: Promise.resolve({ id }) });
const callCase = (id: string) =>
  GET_CASE(new Request(`http://localhost/api/devcase/${id}`), { params: Promise.resolve({ id }) });

type WirePosting = { id: string; caseId: string; status: string; inFlight: unknown; submissions: Array<Record<string, unknown> & { id: string }> };

test("another workspace's case answers 404 DEVCASE_CASE_NOT_FOUND, byte-identical to GET /api/devcase/[id]", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call(foreignId);
  const ref = await callCase(foreignId);
  assert.equal(res.status, 404);
  assert.equal(res.status, ref.status);
  const text = await res.text();
  assert.equal(text, await ref.text());
  assert.equal((JSON.parse(text) as { code?: string }).code, "DEVCASE_CASE_NOT_FOUND");
  assert.ok(!text.includes("tok-channels-foreign"));
});

test("an unknown id answers the same 404 as a foreign one", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call("dc_does_not_exist");
  assert.equal(res.status, 404);
  assert.equal(await res.text(), await (await callCase("dc_does_not_exist")).text());
});

test("the own case answers only its own channels, each with its status", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const res = await call(ownId);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { postings: WirePosting[] };
  assert.deepEqual(body.postings.map((p) => p.id), [posting.id]);
  assert.equal(body.postings[0].status, "open");
  assert.equal(body.postings[0].caseId, ownId);
});

test("outcome, promotePreview and inFlight deep-equal the same posting's entry in GET /api/devcase/postings", async () => {
  cookieValue = signSession(mine.id, Date.now());
  const own = ((await (await call(ownId)).json()) as { postings: WirePosting[] }).postings[0];
  const all = ((await (await GET_POSTINGS()).json()) as { postings: WirePosting[] }).postings;
  const ref = all.find((p) => p.id === posting.id);
  assert.ok(ref, "the workspace route lists the posting too");
  const sub = own.submissions.find((s) => s.id === submission.id)!;
  const refSub = ref.submissions.find((s) => s.id === submission.id)!;
  assert.ok(sub.promotePreview, "an evaluated submission carries its preview");
  assert.ok(sub.outcome, "a recorded outcome is joined");
  assert.deepEqual(sub.outcome, refSub.outcome);
  assert.deepEqual(sub.promotePreview, refSub.promotePreview);
  assert.deepEqual(own.inFlight, ref.inFlight);
  assert.equal((own.inFlight as { live: number }).live, 1);
  // One module, two routes: the whole entry is the same.
  assert.deepEqual(own, ref);
});
