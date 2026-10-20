// The conversational apply door over the shared filing core (application-filing.ts),
// driven through the REAL POST handler on a throwaway SQLite file.
//
// What this file pins that the core's own tests cannot: the ROUTE hands the core the
// opening's workspace and the right proof. A job owned by a non-default team W, an
// applicant proving ownership with their emailed ?lead= token: every write the proven
// merge makes (contact, handle, consent, the re_applied line, the newly-reachable
// acknowledgement) lands in W, and none of it in the default workspace.
//
// No profile build runs here (the proven repeat carries no CV onto a healthy entry),
// so nothing spawns Python. unit-db.ts must stay the first project import.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// Same request-scoped i18n stand-ins as reapply-capability-gate.test.ts: the
// translator echoes its key, the locale is "en".
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
const { listOutboxFiltered } = await import("../../../_lib/db/devcase.ts");
const { insertJob } = await import("../../../_lib/job-ingest.ts");
const { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, listConsentEvents, ensureLeadEnrichToken } =
  await import("../../../_lib/db/pipeline.ts");
const { getOrCreateStatusLink } = await import("../../../_lib/application-status-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

const W = "team-conversational-owner";
const JOB_ID = "filing-core-door-job";
const params = { params: Promise.resolve({ id: JOB_ID }) };

function applyRequest(body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost/api/apply/${JOB_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !until(); i++) await new Promise((r) => setTimeout(r, 25));
}

before(() => {
  insertJob({ id: JOB_ID, title: "Platform Engineer" } as never, undefined, "published", W);
});

test("conversational door, job owned by W, proven by the lead token: the merge, consent, event and re-ack all land in W", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "profile-ivo",
    candidateLabel: "Ivo Vlastnik",
    archetype: "unclassified",
    roleFamily: null,
    jobId: JOB_ID,
    jobTitle: "Platform Engineer",
    stage: "Accepted",
    applicantKey: "fixture-key-ivo-vlastnik",
    contact: null,
    sourceChannel: "quick-apply",
    workspaceId: W,
  });
  const token = ensureLeadEnrichToken(entry.id, undefined, W);
  assert.ok(token, "fixture: the entry has a lead token");
  const consentBefore = listConsentEvents(entry.id, W).length;

  const res = await POST(
    applyRequest({ lead: token, answers: { name: "Ivo Vlastnik", email: "ivo@example.invalid", github: "ivo-v", ko_auth: true } }),
    params
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.duplicate, true);
  assert.equal(body.enriched, false, "no rebuild ran (no CV onto a healthy entry)");
  assert.equal(body.message, "apply.alreadyMessage", "the proven repeat's copy is unchanged");
  // Proven: the caller owns this entry, so its status token rides.
  assert.equal(body.statusToken, getOrCreateStatusLink(entry.id));

  const after = getPipelineEntry(entry.id, W);
  assert.ok(after, "the entry is still in W");
  assert.equal(after.contact, "ivo@example.invalid", "contact backfilled in W");
  assert.equal(after.githubHandle, "ivo-v", "handle backfilled in W");
  assert.equal(after.candidateId, "profile-ivo", "no rebuild, no re-point");
  assert.equal(listConsentEvents(entry.id, W).length, consentBefore + 1, "consent refreshed in W");
  const reapplied = listPipelineEventsForEntry(entry.id, 50, W).find((e) => e.kind === "re_applied");
  assert.ok(reapplied, "the repeat is on W's timeline");
  // The audit prose the conversational door has always written, change list included.
  assert.match(reapplied.detail ?? "", /repeat application via conversational apply — contact email captured; GitHub handle captured/);
  assert.equal(listConsentEvents(entry.id, DEFAULT_WORKSPACE_ID).length, 0, "nothing in the default workspace");

  // The newly-reachable acknowledgement, deferred, carrying the entry's status link.
  await settle(() => listOutboxFiltered({ ref: entry.id, limit: 10 }, W).length > 0);
  const rows = listOutboxFiltered({ ref: entry.id, limit: 10 }, W);
  assert.equal(rows.length, 1, "one re-ack to the address just captured");
  assert.equal(rows[0].recipient, "ivo@example.invalid");
  assert.ok((rows[0].body ?? "").includes(`/status/${getOrCreateStatusLink(entry.id)}?lang=`), "the re-ack carries the status link, ?lang= pinned");
});
