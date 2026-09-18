// The recruiter's FEEDBACK-LETTER doors (spark interview-feedback-letter, WP-beta), driven
// through the REAL handlers with real signed sessions:
//
//   GET  /api/decisions/feedback-letters               the queue
//   POST /api/decisions/feedback-letters/[id]/approve  the edited text becomes the final one; sent
//   POST /api/decisions/feedback-letters/[id]/decline  the team does not send individual feedback
//   POST /api/decisions/feedback-letters/[id]/redraft  a fresh draft is queued
//
// What is pinned: the gates (a session, then `pipeline:write` on every write); the queue's
// tenancy and shape (oldest first, open letters only, a consent-lapsed letter can only be
// closed and shows no draft); the human actor recorded from the SESSION; the state guards
// (a moved letter answers a coded 409 and writes nothing, two racing approvals send one
// email); the delivery recorded truthfully — `queued` with no relay, and a send the consent
// gate SUPPRESSED recorded as not delivered while the letter stays readable on the
// candidate's own page; the email in the letter's language, carrying the candidate's status
// link; and the redraft queued with the letter id and the role, never the candidate's name.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). The drafting CLI
// never runs here: PYTHON_CMD names a binary that does not exist, so a queued redraft fails
// at spawn — the door's job is to QUEUE it, and that is what is asserted.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope: a virtual module whose cookie jar
// this file drives, so the auth helpers decide from a real signed session.
const VIRTUAL_HEADERS = "kp-test:next-headers-feedback-letters";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpLetterTestCookie?: () => string | null }).__kpLetterTestCookie = () => cookieValue;
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
            const value = globalThis.__kpLetterTestCookie();
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

// A signing secret AND an operator password: without the password every caller folds to
// owner (open mode) and there would be no authority decision left to prove.
process.env.KP_SECRET = "feedback-letters-secret";
process.env.KP_OPERATOR_PASSWORD = "feedback-letters-password";
process.env.PYTHON_CMD = "kp-feedback-letters-test-has-no-python";
delete process.env.COMMS_WEBHOOK_URL;

const { NextRequest } = await import("next/server");
const { GET: QUEUE } = await import("./route.ts");
const { POST: APPROVE } = await import("./[id]/approve/route.ts");
const { POST: DECLINE } = await import("./[id]/decline/route.ts");
const { POST: REDRAFT } = await import("./[id]/redraft/route.ts");
const { GET: STATUS } = await import("../../status/[token]/route.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { anonymizeEntry, createPipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { interviewLetterById, interviewLetterRequest, interviewLetterSaveDraft } = await import("../../../_lib/db/interview-letters.ts");
const { getOrCreateStatusLink } = await import("../../../_lib/application-status-store.ts");
const { listOutboxFiltered } = await import("../../../_lib/db/devcase.ts");
const { getTask } = await import("../../../_lib/db/tasks.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");
const { signSession } = await import("../../../_lib/auth/session.ts");
const { LETTER_MAX_CHARS } = await import("../../../_lib/interview-letter-types.ts");
const { letterDeliveryFor } = await import("../../../_lib/interview-letter-delivery.ts");

after(() => cleanupUnitDb());

const ORG = "org-letters";
const team = createWorkspace("Letters team", ORG);
const other = createWorkspace("Other letters team", ORG);
const member = (slug: string, name: string, role: "owner" | "viewer", ws: string) => {
  const u = createUser({ orgId: ORG, email: `letters.${slug}@letters.test`, name, status: "active", password: `letters-pw-${slug}-1` });
  upsertMembership(u.id, ws, role);
  return { ...u, ws };
};
const owner = member("owner", "Petra Nováková", "owner", team.id);
const viewer = member("viewer", "Vera Viewer", "viewer", team.id);
const otherOwner = member("other", "Otto Other", "owner", other.id);
function signedInAs(user: { id: string; orgId: string; ws: string } | null): void {
  cookieValue = user === null ? null : signSession(user.ws, Date.now(), { sub: user.id, org: user.orgId });
}

let seq = 0;
let ip = 0;
/** A decided candidate who asked for a letter, in `ws`. */
function letter(ws: string, opts: { draft?: string | null; candidateId?: string; locale?: string; outcome?: "not_selected" | "hired" } = {}) {
  const n = ++seq;
  const { entry } = createPipelineEntry({
    candidateId: opts.candidateId ?? `c-fl-${n}`,
    candidateLabel: `Letter Candidate ${n}`,
    jobId: `job-fl-${n}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
    locale: opts.locale ?? "cs",
    workspaceId: ws,
  });
  const { letter: row } = interviewLetterRequest({ entryId: entry.id, lang: opts.locale ?? "cs", outcome: opts.outcome ?? "not_selected" }, ws);
  if (opts.draft !== null) interviewLetterSaveDraft(row.id, { text: opts.draft ?? "Dobrý den,\n\nděkujeme za rozhovor.", source: "template" }, ws);
  return { entry, letterId: row.id };
}

function post(handler: typeof APPROVE, id: string, body?: unknown) {
  const url = `http://localhost/api/decisions/feedback-letters/${id}/x`;
  const headers: Record<string, string> = { "x-forwarded-for": `10.44.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = new NextRequest(url, { method: "POST", headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return handler(request, { params: Promise.resolve({ id }) });
}
const approve = (id: string, finalText: unknown) => post(APPROVE, id, { finalText });
const decline = (id: string) => post(DECLINE, id);
const redraft = (id: string) => post(REDRAFT, id);
async function queue() {
  const res = await QUEUE();
  return { status: res.status, body: (await res.json()) as { items: Record<string, unknown>[]; truncated: boolean } };
}
async function statusView(entryId: string) {
  const token = getOrCreateStatusLink(entryId);
  const res = await STATUS(new NextRequest(`http://localhost/api/status/${token}`, { headers: { "x-forwarded-for": `10.45.0.${++ip % 250}` } }), {
    params: Promise.resolve({ token }),
  });
  return ((await res.json()) as { letter: Record<string, unknown> }).letter;
}
function lapseConsent(entryId: string) {
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2024-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z", entryId);
}
function letterOutbox(entryId: string, ws: string = team.id) {
  return listOutboxFiltered({ kind: "interview_letter", ref: entryId }, ws);
}
async function settled(taskId: string) {
  for (let i = 0; i < 200; i++) {
    const t = getTask(taskId);
    if (t && !["queued", "running"].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  return getTask(taskId);
}

// ---- the gates --------------------------------------------------------------------------

test("no session: every door answers 401 and writes nothing", async () => {
  const { letterId } = letter(team.id);
  signedInAs(null);
  assert.equal((await QUEUE()).status, 401);
  for (const res of [await approve(letterId, "Hello."), await decline(letterId), await redraft(letterId)]) assert.equal(res.status, 401);
  assert.equal(interviewLetterById(letterId, team.id)?.state, "drafted");
});

test("a viewer reads the queue but every write is FORBIDDEN_CAPABILITY (pipeline:write), with nothing written", async () => {
  const { letterId } = letter(team.id);
  signedInAs(viewer);
  assert.equal((await queue()).status, 200);
  for (const res of [await approve(letterId, "Hello."), await decline(letterId), await redraft(letterId)]) {
    assert.equal(res.status, 403);
    const body = (await res.json()) as { code?: string; capability?: string };
    assert.equal(body.code, "FORBIDDEN_CAPABILITY");
    assert.equal(body.capability, "pipeline:write");
  }
  const row = interviewLetterById(letterId, team.id)!;
  assert.equal(row.state, "drafted");
  assert.equal(row.decidedBy, null);
});

// ---- the queue --------------------------------------------------------------------------

test("the queue: this team's open letters, oldest first, with the fields the section renders", async () => {
  const first = letter(team.id, { outcome: "hired" });
  const second = letter(team.id, { draft: null });
  const foreign = letter(other.id);
  // A decided letter is not on the list.
  const decided = letter(team.id);
  signedInAs(owner);
  assert.equal((await decline(decided.letterId)).status, 200);

  const { status, body } = await queue();
  assert.equal(status, 200);
  const ids = body.items.map((i) => i.id);
  assert.ok(!ids.includes(foreign.letterId), "another team's letter is never in this team's queue");
  assert.ok(!ids.includes(decided.letterId), "a decided letter has left the queue");
  assert.ok(ids.indexOf(first.letterId) < ids.indexOf(second.letterId), "oldest request first");

  const a = body.items.find((i) => i.id === first.letterId)!;
  assert.deepEqual(Object.keys(a).sort(), ["candidateLabel", "closeOnly", "draft", "id", "jobTitle", "lang", "outcome", "requestedAt", "state"]);
  assert.equal(a.candidateLabel, first.entry.candidateLabel);
  assert.equal(a.jobTitle, "Backend Engineer");
  assert.equal(a.outcome, "hired");
  assert.equal(a.state, "drafted");
  assert.equal(a.lang, "cs");
  assert.equal(a.closeOnly, null);
  assert.equal((a.draft as { source: string }).source, "template");
  const b = body.items.find((i) => i.id === second.letterId)!;
  assert.equal(b.state, "requested");
  assert.equal(b.draft, null, "no draft yet");

  // …and the other team sees its own, not ours.
  signedInAs(otherOwner);
  const theirs = (await queue()).body.items.map((i) => i.id);
  assert.ok(theirs.includes(foreign.letterId));
  assert.ok(!theirs.includes(first.letterId));
});

test("a consent-lapsed letter can only be closed: no draft, a masked name, and approve/redraft refused", async () => {
  const lapsed = letter(team.id, { draft: "Dobrý den, Jano Nová." });
  lapseConsent(lapsed.entry.id);
  signedInAs(owner);
  const item = (await queue()).body.items.find((i) => i.id === lapsed.letterId)!;
  assert.equal(item.closeOnly, "consent_withheld");
  assert.equal(item.draft, null, "a draft about the person is withheld at the read boundary");
  assert.notEqual(item.candidateLabel, lapsed.entry.candidateLabel, "the label is masked");

  for (const res of [await approve(lapsed.letterId, "Hello."), await redraft(lapsed.letterId)]) {
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code?: string }).code, "FEEDBACK_LETTER_CONSENT_WITHHELD");
  }
  const row = interviewLetterById(lapsed.letterId, team.id)!;
  assert.equal(row.state, "drafted");
  assert.equal(row.finalText, null, "nothing is written about a person whose consent lapsed");
  assert.deepEqual(letterOutbox(lapsed.entry.id), []);

  // A decline still closes it — it writes who decided, and nothing about the candidate.
  const res = await decline(lapsed.letterId);
  assert.equal(res.status, 200);
  assert.equal(interviewLetterById(lapsed.letterId, team.id)?.state, "declined");
});

// ---- approve ----------------------------------------------------------------------------

test("approve: the edited text becomes the final one, from the signed-in person, sent in the letter's language with the status link", async () => {
  const { entry, letterId } = letter(team.id, { locale: "cs" });
  signedInAs(owner);
  const edited = "  Dobrý den,\n\nděkujeme za Váš čas. Silnou stránkou byla komunikace.\n\nS pozdravem\nNáborový tým  ";
  const res = await approve(letterId, edited);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; letter: { id: string; state: string }; delivery: Record<string, unknown> };
  assert.equal(body.ok, true);
  assert.equal(body.letter.state, "sent");
  // No relay in this environment: the outbox row IS the destination — `queued`, never "sent".
  assert.deepEqual(body.delivery, { delivery: "queued", suppressed: false, readableOnStatusPage: true, recorded: true });

  const row = interviewLetterById(letterId, team.id)!;
  assert.equal(row.state, "sent");
  assert.equal(row.finalText, edited.trim(), "the recruiter's text, verbatim but for the ends");
  assert.equal(row.decidedBy, "human:Petra Nováková", "the actor comes from the session's own user");
  assert.equal(row.delivery, "queued", "the letter records what the outbox reported");

  const [mail] = letterOutbox(entry.id);
  assert.ok(mail, "one outbox row of the new kind");
  assert.equal(mail.kind, "interview_letter");
  assert.equal(mail.status, "queued");
  assert.match(mail.subject ?? "", /^Zpětná vazba k vašemu pohovoru: Backend Engineer$/, "the subject is in the letter's language");
  assert.ok((mail.body ?? "").startsWith(edited.trim()), "the body opens with the approved text, untouched");
  const token = getOrCreateStatusLink(entry.id);
  assert.ok((mail.body ?? "").includes(`/status/${token}?lang=cs`), "the email carries the candidate's own status link, pinned to the letter's language");

  // The candidate's page shows the approved letter.
  const view = await statusView(entry.id);
  assert.equal(view.state, "sent");
  assert.equal(view.text, edited.trim());
});

test("approve refuses an empty or over-long text BEFORE anything is stored", async () => {
  const { letterId } = letter(team.id);
  signedInAs(owner);
  const empty = await approve(letterId, "   ");
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as { code?: string }).code, "FEEDBACK_LETTER_TEXT_EMPTY");
  const long = await approve(letterId, "x".repeat(LETTER_MAX_CHARS + 1));
  assert.equal(long.status, 400);
  const longBody = (await long.json()) as { code?: string; maxChars?: number };
  assert.equal(longBody.code, "FEEDBACK_LETTER_TEXT_TOO_LONG");
  assert.equal(longBody.maxChars, LETTER_MAX_CHARS, "the cap rides as data");
  const missing = await approve(letterId, undefined);
  assert.equal(((await missing.json()) as { code?: string }).code, "FEEDBACK_LETTER_TEXT_EMPTY");
  assert.equal(interviewLetterById(letterId, team.id)?.state, "drafted");
});

test("a letter from another team is not found, and nothing moves", async () => {
  const foreign = letter(other.id);
  signedInAs(owner);
  for (const res of [await approve(foreign.letterId, "Hello."), await decline(foreign.letterId), await redraft(foreign.letterId)]) {
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code?: string }).code, "FEEDBACK_LETTER_NOT_FOUND");
  }
  assert.equal(interviewLetterById(foreign.letterId, other.id)?.state, "drafted");
});

test("a moved letter answers a coded 409 with its state, and writes nothing", async () => {
  const { entry, letterId } = letter(team.id);
  signedInAs(owner);
  assert.equal((await approve(letterId, "First and final.")).status, 200);
  for (const res of [await approve(letterId, "A second approval."), await decline(letterId), await redraft(letterId)]) {
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code?: string; state?: string };
    assert.equal(body.code, "FEEDBACK_LETTER_MOVED");
    assert.equal(body.state, "sent");
  }
  const row = interviewLetterById(letterId, team.id)!;
  assert.equal(row.finalText, "First and final.");
  assert.equal(letterOutbox(entry.id).length, 1, "one approval, one email");
});

test("two racing approvals: exactly one lands, the other is told the letter moved, one email goes out", async () => {
  const { entry, letterId } = letter(team.id);
  signedInAs(owner);
  const answers = await Promise.all([approve(letterId, "Version A."), approve(letterId, "Version B.")]);
  const statuses = answers.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = answers.find((r) => r.status === 409)!;
  assert.equal(((await loser.json()) as { code?: string }).code, "FEEDBACK_LETTER_MOVED");
  assert.equal(letterOutbox(entry.id).length, 1);
  assert.ok(["Version A.", "Version B."].includes(interviewLetterById(letterId, team.id)!.finalText ?? ""));
});

test("a send the consent gate suppresses is recorded as not delivered, and the letter stays readable on the candidate's page", async () => {
  // The same PERSON applied twice; their other application was erased. The channel's gate
  // resolves consent at the candidate identity, so no email may reach them — while THIS
  // application's own consent still stands, so its status page may show the letter.
  const candidateId = "c-fl-suppressed";
  const { entry, letterId } = letter(team.id, { candidateId });
  const { entry: erased } = createPipelineEntry({
    candidateId,
    candidateLabel: "Letter Candidate twin",
    jobId: "job-fl-twin",
    jobTitle: "Data Engineer",
    workspaceId: team.id,
  });
  assert.ok(anonymizeEntry(erased.id, "erasure", team.id));

  signedInAs(owner);
  const res = await approve(letterId, "Dobrý den, děkujeme.");
  assert.equal(res.status, 200, "the approval is a person's decision and stands");
  const body = (await res.json()) as { delivery: Record<string, unknown> };
  assert.deepEqual(body.delivery, { delivery: "failed", suppressed: true, readableOnStatusPage: true, recorded: true });
  const row = interviewLetterById(letterId, team.id)!;
  assert.equal(row.state, "sent");
  assert.equal(row.delivery, "failed", "never `queued`: no outbox row exists to have queued");
  assert.deepEqual(letterOutbox(entry.id), [], "nothing left the building");
  const view = await statusView(entry.id);
  assert.equal(view.text, "Dobrý den, děkujeme.", "their own page shows it: this application's consent allows");
});

test("the outbox's word is the letter's word: bounced is never a delivery", () => {
  assert.equal(letterDeliveryFor("sent"), "sent");
  assert.equal(letterDeliveryFor("queued"), "queued");
  assert.equal(letterDeliveryFor("failed"), "failed");
  assert.equal(letterDeliveryFor("bounced"), "failed");
});

// ---- decline ----------------------------------------------------------------------------

test("decline: closed by the signed-in person, said on the candidate's page, no email", async () => {
  const { entry, letterId } = letter(team.id);
  signedInAs(owner);
  const res = await decline(letterId);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { letter: { state: string } };
  assert.equal(body.letter.state, "declined");
  const row = interviewLetterById(letterId, team.id)!;
  assert.equal(row.decidedBy, "human:Petra Nováková");
  assert.equal(row.finalText, null);
  assert.deepEqual(letterOutbox(entry.id), [], "a decline sends no letter");
  const view = await statusView(entry.id);
  assert.equal(view.state, "declined", "the page tells the candidate, never leaves it pending");
  assert.equal(view.text, null);
});

// ---- redraft ----------------------------------------------------------------------------

test("redraft queues ONE draft task with the letter id and the role, never the candidate's name", async () => {
  const { entry, letterId } = letter(team.id);
  signedInAs(owner);
  const res = await redraft(letterId);
  assert.equal(res.status, 200);
  const { taskId } = (await res.json()) as { taskId: string };
  const task = getTask(taskId);
  assert.equal(task?.kind, "interview_letter");
  const params = ensureDb().prepare(`SELECT params_json, workspace_id FROM tasks WHERE id = ?`).get(taskId) as { params_json: string; workspace_id: string };
  assert.deepEqual(JSON.parse(params.params_json), { letterId, jobTitle: "Backend Engineer" });
  assert.equal(params.workspace_id, team.id, "queued in the letter's own team");
  assert.ok(!params.params_json.includes(entry.candidateLabel ?? " "), "the task row outlives an erasure: no name on it");
  // A second click while the first is in flight is the same task (deduped on the letter).
  const again = (await (await redraft(letterId)).json()) as { taskId: string };
  if (["queued", "running"].includes(getTask(taskId)?.status ?? "")) assert.equal(again.taskId, taskId);
  await settled(taskId);
  await settled(again.taskId);
  // The spawn failed (no Python here): the letter is untouched and still open for a person.
  assert.equal(interviewLetterById(letterId, team.id)?.state, "drafted");
});
