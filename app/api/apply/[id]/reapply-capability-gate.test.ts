// THE WRITE SIDE OF THE DUPLICATE BRANCH — behavioural, over the real handler.
//
// The READ side was already gated: a repeat application detected from the
// submitted name/email alone no longer gets the matched entry's status/lead
// tokens in its JSON (apply-error-hygiene.test.ts pins that). The WRITE side was
// not. `findApplicationByApplicant(job.id, providedName, email, ws)` matches on a
// bare name — which is not a secret — and the branch then merged unconditionally:
// it backfilled the contact address, backfilled the GitHub handle, rebuilt the
// stored profile from attacker-supplied CV text over the victim's candidate id,
// wrote a `re_applied` event into the recruiter's feed and refreshed the
// data-processing consent (which re-extends the GDPR retention clock).
//
// So anyone who knew an applicant's name could set that person's reachability to
// an address they control, poison their profile, and keep their record alive.
//
// The rule this file pins: the MUTATING half runs only when the caller proved
// possession of the entry with the ?lead= capability token. Without it the
// response is still the honest tokenless "you already applied" acknowledgement —
// the candidate must be told — and nothing on the entry moves.
//
// Driven against the REAL POST handler on a throwaway SQLite file. unit-db.ts
// must stay the first project import.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// Point next/server at the shared shim BEFORE the route loads (hooks only affect
// later resolutions — hence the dynamic imports at the bottom).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// The route's two request-scoped i18n dependencies cannot run outside a Next
// request scope (`getTranslations` reads the request config, `getServerLocale`
// reads cookies()). Neither is what this file is about, so both resolve to
// virtual modules: the translator echoes its key, the locale is "en".
const VIRTUAL_INTL = "kp-test:next-intl-server";
const VIRTUAL_I18N = "kp-test:i18n-server";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next-intl/server") return { url: VIRTUAL_INTL, shortCircuit: true };
    if (specifier === "@/i18n/server") return { url: VIRTUAL_I18N, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_INTL) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export async function getTranslations(ns) { return (key) => ns + "." + key; }`,
      };
    }
    if (url === VIRTUAL_I18N) {
      return { format: "module", shortCircuit: true, source: `export async function getServerLocale() { return "en"; }` };
    }
    return nextLoad(url, context);
  },
});

const { POST } = await import("./route.ts");
const { POST: QUICK_POST } = await import("./quick/route.ts");
const { listOutboxFiltered } = await import("../../../_lib/db/devcase.ts");
const { getOrCreateStatusLink } = await import("../../../_lib/application-status-store.ts");
const { getJob } = await import("../../../_lib/db/jobs.ts");
const { applyKoSteps } = await import("../../../_lib/apply.ts");
const { insertJob } = await import("../../../_lib/job-ingest.ts");
const { createPipelineEntry, listEntriesForJob, listPipelineEventsForEntry, listConsentEvents, ensureLeadEnrichToken } =
  await import("../../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

const JOB_ID = "reapply-gate-job";


/** The original application: on file, reachable at NOTHING (the contactless entry
 *  is the one a backfill can actually move) and with no GitHub handle. */
function seedVictim(name: string, contact: string | null = null, sourceChannel = "apply"): string {
  const { entry } = createPipelineEntry({
    candidateId: `profile-${name.replace(/\W+/g, "-").toLowerCase()}`,
    candidateLabel: name,
    archetype: "unclassified",
    roleFamily: null,
    jobId: JOB_ID,
    jobTitle: "Backend Engineer",
    stage: "Accepted",
    dedupeKey: `apply-${name.toLowerCase()}`,
    contact,
    sourceChannel,
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  return entry.id;
}

/** A POST at the public apply door. `lead` is the ?lead= capability token when the
 *  caller has one — the whole variable under test. */
function applyRequest(body: Record<string, unknown>): NextRequest {
  // A plain Request is enough here: this handler reads only `url`, `headers` and the
  // body — never `nextUrl`/`cookies`, the two members the shim exists to add.
  return new Request(`http://localhost/api/apply/${JOB_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: JOB_ID }) };

before(() => {
  insertJob({ id: JOB_ID, title: "Backend Engineer" } as never, undefined, "published", DEFAULT_WORKSPACE_ID);
});

test("a name+email match with NO lead token changes nothing on the matched entry", async () => {
  const name = "Dana Applicantova";
  const entryId = seedVictim(name);
  const eventsBefore = listPipelineEventsForEntry(entryId).length;
  const consentBefore = listConsentEvents(entryId).length;

  const res = await POST(
    applyRequest({
      answers: {
        name, // public knowledge — the whole point
        email: "attacker@example.invalid", // the address the impostor wants on file
        github: "attacker",
        ko_auth: true,
      },
    }),
    params
  );
  const body = (await res.json()) as Record<string, unknown>;

  // The candidate is still told the truth: they already applied.
  assert.equal(res.status, 200);
  assert.equal(body.result, "accepted");
  assert.equal(body.duplicate, true);
  // …and gets none of the entry's capabilities (the read-side gate, still held).
  assert.equal(body.statusToken, undefined);
  assert.equal(body.followupToken, undefined);

  // NOTHING moved on the entry.
  const after = listEntriesForJob(JOB_ID).find((e) => e.id === entryId);
  assert.ok(after, "the original entry must still exist");
  assert.equal(after.contact, null, "an unproven repeat must not set the applicant's contact address");
  assert.equal(after.githubHandle ?? null, null, "an unproven repeat must not backfill the GitHub handle");
  assert.equal(after.candidateId, `profile-${name.replace(/\W+/g, "-").toLowerCase()}`, "an unproven repeat must not re-point the stored profile");
  assert.equal(
    listPipelineEventsForEntry(entryId).length,
    eventsBefore,
    "an unproven repeat must not write into the recruiter's activity feed"
  );
  assert.equal(
    listConsentEvents(entryId).length,
    consentBefore,
    "an unproven repeat must not refresh the data-processing consent (it re-extends the retention clock)"
  );

  // And it did not fork a second row either — the dedupe policy is unchanged.
  assert.equal(listEntriesForJob(JOB_ID).filter((e) => e.id === entryId).length, 1);

  // Link recovery: there is no address on file, so nothing is sent — and no refused
  // `failed` Outbox row is minted for a recipient that does not exist. Above all, the
  // TYPED address never receives anything.
  await settle();
  assert.equal(outboxFor(entryId).length, 0, "a contactless entry gets no recovery row at all");
  assert.equal(
    listOutboxFiltered({ limit: 500 }, DEFAULT_WORKSPACE_ID).filter((r) => (r.recipient ?? "").includes("attacker@")).length,
    0,
    "nothing is ever sent to the address the caller typed"
  );
});

/** Recovery dispatches after the response (afterResponse); the shim runs it detached.
 *  Wait for it to land (or, for a negative case, for long enough that it would have). */
async function settle(until?: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (until?.()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function outboxFor(entryId: string) {
  return listOutboxFiltered({ ref: entryId, limit: 50 }, DEFAULT_WORKSPACE_ID);
}

test("an unproven repeat re-sends the entry's OWN links to the address ON FILE, once per cooldown", async () => {
  const name = "Lena Ztracena";
  const onFile = "lena.z@example.invalid";
  const entryId = seedVictim(name, onFile);
  const eventsBefore = listPipelineEventsForEntry(entryId).length;
  const consentBefore = listConsentEvents(entryId).length;

  // Same person, same address, typed differently: the match is the normalized email.
  const res = await POST(applyRequest({ answers: { name, email: "  LENA.Z@Example.invalid ", ko_auth: true } }), params);
  assert.equal(res.status, 200);
  const raw = await res.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(body.duplicate, true);
  assert.equal(body.statusToken, undefined);
  assert.equal(body.leadToken, undefined);
  assert.equal(body.followupToken, undefined);
  // The copy does not claim a renewed interest was noted: nothing was.
  assert.notEqual(body.message, "apply.alreadyMessage");

  await settle(() => outboxFor(entryId).length > 0);
  const rows = outboxFor(entryId);
  assert.equal(rows.length, 1, "exactly one recovery message");
  assert.equal(rows[0].recipient, onFile, "addressed to the contact ON FILE, never the typed string");
  const statusToken = getOrCreateStatusLink(entryId);
  const leadToken = ensureLeadEnrichToken(entryId);
  assert.ok(leadToken);
  const mail = rows[0].body ?? "";
  assert.ok(mail.includes(`/status/${statusToken}`), "the body carries the entry's own status link");
  assert.match(mail, new RegExp(`/apply/${JOB_ID}\\?[^\\s]*lead=${leadToken}`), "…and its enrichment link");
  // The tokens reached the inbox, never the wire.
  assert.ok(!raw.includes(statusToken) && !raw.includes(leadToken), "no capability token in the response body");

  // Nothing moved on the entry, and nothing reached the recruiter's feed: the
  // Outbox row IS the audit for an unproven path.
  const after = listEntriesForJob(JOB_ID).find((e) => e.id === entryId);
  assert.equal(after?.contact, onFile);
  assert.equal(listPipelineEventsForEntry(entryId).length, eventsBefore, "no pipeline event for a recovery email");
  assert.equal(listConsentEvents(entryId).length, consentBefore, "no consent refresh");

  // The same unproven POST again, immediately: still an honest duplicate, no second mail.
  const again = await POST(applyRequest({ answers: { name, email: onFile, ko_auth: true } }), params);
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as Record<string, unknown>).duplicate, true);
  await settle();
  assert.equal(outboxFor(entryId).length, 1, "the per-entry cooldown holds: one recovery per 24h");
});

test("the quick-apply door answers a known address the same way: no tokens, one recovery to the address on file", async () => {
  const name = "Quinn Rychla";
  const onFile = "quinn@example.invalid";
  const entryId = seedVictim(name, onFile, "quick-apply");
  const eventsBefore = listPipelineEventsForEntry(entryId).length;
  const job = getJob(JOB_ID);
  assert.ok(job);
  const ko = Object.fromEntries(applyKoSteps(job, ((k: string) => k) as never).map((s) => [s.id, true]));

  const res = await QUICK_POST(
    new Request(`http://localhost/api/apply/${JOB_ID}/quick`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
      body: JSON.stringify({ answers: { name, email: onFile, ...ko } }),
    }) as unknown as NextRequest,
    params
  );
  assert.equal(res.status, 200);
  const raw = await res.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(body.duplicate, true);
  assert.equal(body.statusToken, undefined);
  assert.equal(body.leadToken, undefined);

  await settle(() => outboxFor(entryId).length > 0);
  const rows = outboxFor(entryId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, onFile);
  assert.ok((rows[0].body ?? "").includes(`/status/${getOrCreateStatusLink(entryId)}`));
  assert.ok(!raw.includes(getOrCreateStatusLink(entryId)));
  // The lead core's own `re_applied` line predates this (the quick door's channel
  // proof, lead-intake.ts); the recovery adds nothing beside it.
  const added = listPipelineEventsForEntry(entryId).slice(eventsBefore).map((e) => e.kind);
  assert.deepEqual(added.filter((k) => k !== "re_applied"), [], "no pipeline event for a recovery email");
});

test("quick-apply: an entry that only NOW becomes reachable gets the core's ack, not a second recovery mail", async () => {
  const name = "Rita Bezadresy";
  const entryId = seedVictim(name, null, "quick-apply");
  const job = getJob(JOB_ID);
  assert.ok(job);
  const ko = Object.fromEntries(applyKoSteps(job, ((k: string) => k) as never).map((s) => [s.id, true]));
  const res = await QUICK_POST(
    new Request(`http://localhost/api/apply/${JOB_ID}/quick`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.8" },
      body: JSON.stringify({ answers: { name, email: "rita@example.invalid", ...ko } }),
    }) as unknown as NextRequest,
    params
  );
  assert.equal(res.status, 200);
  await settle(() => outboxFor(entryId).length > 0);
  await settle();
  assert.equal(outboxFor(entryId).length, 1, "one message: the newly-reachable acknowledgement only");
});

test("the SAME repeat, carrying the entry's lead token, merges as before", async () => {
  const name = "Eva Vracejici";
  const entryId = seedVictim(name);
  const token = ensureLeadEnrichToken(entryId);
  assert.ok(token, "the fixture needs a lead-enrichment token to prove ownership with");

  const res = await POST(
    applyRequest({
      lead: token,
      answers: { name, email: "dana@example.invalid", github: "dana", ko_auth: true },
    }),
    params
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.duplicate, true);

  const after = listEntriesForJob(JOB_ID).find((e) => e.id === entryId);
  assert.equal(after?.contact, "dana@example.invalid", "the proven enrichment walk still backfills the contact");
  assert.equal(after?.githubHandle, "dana", "the proven enrichment walk still backfills the handle");
  assert.ok(
    listPipelineEventsForEntry(entryId).some((e) => e.kind === "re_applied"),
    "the proven repeat still records what it contributed"
  );
});
