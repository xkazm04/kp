// The per-candidate kit overlay write — PATCH /api/interview-prep { kitOverlay } — and the
// kit the GET now carries (spark interview-kit-template, WP-C), driven through the REAL
// handlers with real signed sessions.
//
// What is pinned: the seat is asked first (a viewer is refused with the coded 403 and
// nothing is written); a valid overlay is stored as sent, rebuilt from its known keys; a
// cap or a malformed body is a CODED refusal carrying `reason` as data, never a silent
// partial store; the tenancy read that authorizes every sibling verb authorizes this one;
// the weave that shares the verb still works; the other human keys on the pack survive
// the write, and the overlay survives both the checklist autosave and a regeneration.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; resolve it to a virtual module
// whose cookie jar this file drives, so the auth helpers decide from a real session.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpOverlayTestCookie?: () => string | null }).__kpOverlayTestCookie = () => cookieValue;
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
            const value = globalThis.__kpOverlayTestCookie();
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
process.env.KP_SECRET = "interview-prep-overlay-secret";
process.env.KP_OPERATOR_PASSWORD = "interview-prep-overlay-password";

const { GET, PUT, PATCH } = await import("./route.ts");
const { getInterviewPrep, saveInterviewPrep } = await import("../../_lib/interview-prep.ts");
const { mergeRegeneratedPrep } = await import("../../_lib/interview-prep-run.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createInterviewSession } = await import("../../_lib/db/interviews.ts");
const { interviewKitAppendVersion } = await import("../../_lib/db/interview-kits.ts");
const { insertJob } = await import("../../_lib/job-ingest.ts");
const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership } = await import("../../_lib/db/memberships.ts");
const { signSession } = await import("../../_lib/auth/session.ts");
const { KIT_OVERLAY_MAX_ADDED } = await import("../../_lib/interview-kit-overlay.ts");
import type { InterviewKit, KitOverlay } from "../../_lib/interview-kit-types.ts";

after(() => cleanupUnitDb());

const ORG = "org-overlay";
const team = createWorkspace("Overlay team", ORG);
const other = createWorkspace("Other team", ORG);
const mk = (slug: string, role: "owner" | "viewer") => {
  const u = createUser({ orgId: ORG, email: `overlay.${slug}@overlay.test`, name: `Overlay ${slug}`, status: "active", password: `overlay-pw-${slug}-1` });
  upsertMembership(u.id, team.id, role);
  return u;
};
const owner = mk("owner", "owner");
const viewer = mk("viewer", "viewer");
function signedInAs(user: { id: string; orgId: string } | null): void {
  cookieValue = user === null ? null : signSession(team.id, Date.now(), { sub: user.id, org: user.orgId });
}

const KIT: InterviewKit = {
  version: 1,
  competencies: [
    {
      id: "c-strategy",
      title: "Test strategy",
      weight: 3,
      budgetMin: 6,
      questions: [{ id: "q-first", text: "How do you decide what to automate first?", mustAsk: true }],
    },
  ],
  faq: [],
};

let seq = 0;
/** An entry in `ws` with a prep pack (and its role's job row). */
function preppedEntry(ws: string, extra: Record<string, unknown> = {}) {
  const n = ++seq;
  const jobId = insertJob({ id: `job-ov-${n}`, title: "QA Engineer", company: "Acme", location: "Praha", description: "QA." }, undefined, "published", ws).id;
  const { entry } = createPipelineEntry({ candidateId: `cand-ov-${n}`, candidateLabel: `Kandidat ${n}`, jobId, jobTitle: "QA Engineer", workspaceId: ws });
  saveInterviewPrep(entry.id, entry.candidateLabel ?? null, "QA Engineer", {
    scenario: "A structured interview.",
    durationMin: 25,
    chronology: [{ topic: "Depth", questions: ["Walk me through your flakiest test."], fromMin: 0, toMin: 10 }],
    signals: [],
    source: "deterministic",
    lang: "en",
    userProgress: { checked: { "c-0": true }, notes: "strong on flakiness" },
    interviewer: "amy@corp.test",
    ...extra,
  });
  return { entryId: entry.id, jobId };
}

const url = (entryId: string) => `http://localhost/api/interview-prep?entry=${encodeURIComponent(entryId)}`;
function req(method: string, entryId: string, body?: unknown, raw?: string): NextRequest {
  const r = new Request(url(entryId), {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body ?? {}) }),
  }) as unknown as NextRequest & { nextUrl?: URL };
  // The handlers read `request.nextUrl`; a plain Request has none.
  Object.defineProperty(r, "nextUrl", { value: new URL(url(entryId)) });
  return r as NextRequest;
}

const OVERLAY: KitOverlay = {
  version: 1,
  dropped: ["q-first"],
  edited: [{ id: "cv-1234abcd", text: "  Walk me through the flakiest test you fixed.  " }],
  added: [{ id: "ov-a", competencyId: "c-strategy", text: "Who do you pair with?", mustAsk: true }],
};

const storedOverlay = (entryId: string) => (getInterviewPrep(entryId, team.id)?.payload as { kitOverlay?: unknown }).kitOverlay;

// ---- the gate ---------------------------------------------------------------------------

test("a viewer is refused with FORBIDDEN_CAPABILITY and nothing is written", async () => {
  const { entryId } = preppedEntry(team.id);
  signedInAs(viewer);
  const r = await PATCH(req("PATCH", entryId, { kitOverlay: OVERLAY }));
  assert.equal(r.status, 403);
  const body = (await r.json()) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "pipeline:write");
  assert.equal(storedOverlay(entryId), undefined);
});

test("no session at all is a 401", async () => {
  const { entryId } = preppedEntry(team.id);
  signedInAs(null);
  const r = await PATCH(req("PATCH", entryId, { kitOverlay: OVERLAY }));
  assert.equal(r.status, 401);
});

// ---- the write ------------------------------------------------------------------------

test("an owner's overlay is stored, rebuilt from its known keys, beside the other human keys", async () => {
  const { entryId } = preppedEntry(team.id);
  signedInAs(owner);
  const sent = { ...OVERLAY, smuggled: "x", added: [{ ...OVERLAY.added[0], extra: "y" }] };
  const r = await PATCH(req("PATCH", entryId, { kitOverlay: sent }));
  assert.equal(r.status, 200);
  const body = (await r.json()) as { ok: boolean; kitOverlay: KitOverlay };
  const expected: KitOverlay = {
    version: 1,
    dropped: ["q-first"],
    edited: [{ id: "cv-1234abcd", text: "Walk me through the flakiest test you fixed." }],
    added: [{ id: "ov-a", competencyId: "c-strategy", text: "Who do you pair with?", mustAsk: true }],
  };
  assert.deepEqual(body.kitOverlay, expected);
  assert.deepEqual(storedOverlay(entryId), expected, "stored exactly as answered: trimmed, no smuggled keys");
  const payload = getInterviewPrep(entryId, team.id)?.payload as Record<string, unknown>;
  assert.deepEqual(payload.userProgress, { checked: { "c-0": true }, notes: "strong on flakiness" }, "the checklist survives");
  assert.equal(payload.interviewer, "amy@corp.test");
  assert.equal(payload.scenario, "A structured interview.", "the generated plan is untouched");
});

test("a cap is a coded refusal with the rule as data, and the stored overlay is unchanged", async () => {
  const { entryId } = preppedEntry(team.id, { kitOverlay: OVERLAY });
  signedInAs(owner);
  const tooMany = {
    ...OVERLAY,
    added: Array.from({ length: KIT_OVERLAY_MAX_ADDED + 1 }, (_, i) => ({ id: `ov-${i}`, competencyId: null, text: `Q${i}?`, mustAsk: false })),
  };
  const r = await PATCH(req("PATCH", entryId, { kitOverlay: tooMany }));
  assert.equal(r.status, 400);
  const body = (await r.json()) as { code?: string; reason?: string };
  assert.equal(body.code, "INTERVIEW_PREP_OVERLAY_INVALID");
  assert.equal(body.reason, "too_many_added");
  assert.deepEqual(storedOverlay(entryId), OVERLAY, "a refused write writes nothing");

  const blank = await PATCH(req("PATCH", entryId, { kitOverlay: { ...OVERLAY, edited: [{ id: "q-first", text: "   " }] } }));
  assert.equal(((await blank.json()) as { reason?: string }).reason, "text_empty");
});

test("a malformed overlay is refused, never half-stored", async () => {
  const { entryId } = preppedEntry(team.id);
  signedInAs(owner);
  const bad: unknown[] = [
    null,
    "overlay",
    { version: 2, dropped: [], edited: [], added: [] },
    { version: 1, dropped: [] },
    { version: 1, dropped: ["q-first", 7], edited: [], added: [] },
    { version: 1, dropped: [], edited: [{ id: "q-first" }], added: [] },
    { version: 1, dropped: [], edited: [], added: [{ id: "ov-a", text: "Q?", mustAsk: "yes" }] },
    { version: 1, dropped: [], edited: [], added: [{ id: "ov-a", text: "Q?", competencyId: 3 }] },
  ];
  for (const kitOverlay of bad) {
    const r = await PATCH(req("PATCH", entryId, { kitOverlay }));
    assert.equal(r.status, 400, JSON.stringify(kitOverlay));
    const body = (await r.json()) as { code?: string; reason?: string };
    assert.equal(body.code, "INTERVIEW_PREP_OVERLAY_INVALID");
    assert.equal(body.reason, "malformed");
  }
  assert.equal(storedOverlay(entryId), undefined);
});

test("no pack, or another team's pack, is the same 404 — the tenancy read authorizes the write", async () => {
  signedInAs(owner);
  const none = await PATCH(req("PATCH", "m-no-such-entry", { kitOverlay: OVERLAY }));
  assert.equal(none.status, 404);
  assert.equal(((await none.json()) as { code?: string }).code, "INTERVIEW_PREP_NOT_FOUND");
  const foreign = preppedEntry(other.id);
  const r = await PATCH(req("PATCH", foreign.entryId, { kitOverlay: OVERLAY }));
  assert.equal(r.status, 404);
  assert.equal(
    (getInterviewPrep(foreign.entryId, other.id)?.payload as { kitOverlay?: unknown }).kitOverlay,
    undefined,
    "another team's plan is never written"
  );
});

test("an oversized body is a 413 before anything is parsed", async () => {
  const { entryId } = preppedEntry(team.id);
  signedInAs(owner);
  const r = await PATCH(req("PATCH", entryId, undefined, JSON.stringify({ kitOverlay: { ...OVERLAY, pad: "x".repeat(300 * 1024) } })));
  assert.equal(r.status, 413);
  assert.equal(((await r.json()) as { code?: string }).code, "PAYLOAD_TOO_LARGE");
});

test("the weave that shares the verb is unchanged", async () => {
  const { entryId } = preppedEntry(team.id, { importedQuestions: ["How do you review a PR?"] });
  signedInAs(owner);
  const r = await PATCH(req("PATCH", entryId, { question: "How do you review a PR?", blockRef: "Depth" }));
  assert.equal(r.status, 200);
  assert.deepEqual(((await r.json()) as { importedQuestions: unknown }).importedQuestions, [{ question: "How do you review a PR?", blockRef: "Depth" }]);
});

// ---- the overlay survives the other writes ------------------------------------------------

test("the checklist autosave (PUT) keeps the overlay", async () => {
  const { entryId } = preppedEntry(team.id, { kitOverlay: OVERLAY });
  signedInAs(owner);
  const r = await PUT(req("PUT", entryId, { checked: { "c-0": true }, notes: "updated", interviewer: "bo@corp.test" }));
  assert.equal(r.status, 200);
  assert.deepEqual(storedOverlay(entryId), OVERLAY);
});

test("a regeneration keeps the overlay (the generator never owns kitOverlay)", async () => {
  const { entryId } = preppedEntry(team.id, { kitOverlay: OVERLAY });
  // What runInterviewPrep does after its (Python-backed) generation: merge the fresh
  // plan over the previous payload, then save it as a regeneration.
  const prev = getInterviewPrep(entryId, team.id);
  const generated = { scenario: "A fresh plan.", durationMin: 30, focusAreas: [], chronology: [], signals: [], source: "llm", lang: "en" };
  saveInterviewPrep(entryId, prev?.candidateLabel ?? null, prev?.jobTitle ?? null, mergeRegeneratedPrep(prev?.payload, generated), { regenerated: true });
  assert.deepEqual(storedOverlay(entryId), OVERLAY);
  assert.equal((getInterviewPrep(entryId, team.id)?.payload as { scenario?: string }).scenario, "A fresh plan.");
});

// ---- the GET carries the kit this candidate's interview runs on ----------------------------

test("GET: no kit is null; a published kit is the one the next link carries; an open link's pin wins", async () => {
  const { entryId, jobId } = preppedEntry(team.id);
  signedInAs(owner);
  const read = async () => ((await (await GET(req("GET", entryId))).json()) as { kit: { kitId: string; version: number; pinned: boolean; cvProbesRide: boolean; kit: InterviewKit } | null }).kit;

  assert.equal(await read(), null, "a role with no kit: nothing for the overlay to edit");

  const v1 = interviewKitAppendVersion({ jobId, kit: KIT, source: "generated", status: "published" }, team.id);
  const live = await read();
  assert.equal(live?.kitId, v1.id);
  assert.equal(live?.pinned, false, "no link yet: the live version the next link will carry");
  assert.equal(live?.cvProbesRide, true, "an experienced candidate's own probes ride the prep branch");
  assert.deepEqual(live?.kit, KIT);

  // A link minted on v1, then v2 published: the candidate holding the link still faces v1.
  createInterviewSession({ provider: "openai", mode: "candidate", entryId, jobId, kitId: v1.id });
  const v2 = interviewKitAppendVersion({ jobId, kit: { ...KIT, note: "v2" }, source: "edited", status: "published" }, team.id);
  const pinned = await read();
  assert.equal(pinned?.kitId, v1.id, "the pin wins over the newer publish");
  assert.equal(pinned?.pinned, true);
  assert.notEqual(pinned?.kitId, v2.id);
});
