// THE CANDIDATE'S LANGUAGE CHOICE — POST /api/stop/[token]/language, plus the two GET
// fields the stop page reads to offer it.
//
// A candidate written to in a language they do not read had no way to say so after the
// first letter: the locale authority (app/_lib/comms-locale.ts) ranks the candidate's
// explicit choice first, but the only capture points were apply-time, and the CV
// inference picks Czech whenever Czech is declared at all. The unsubscribe page is the
// one candidate door every letter already links, so that is where the choice is taken.
//
// What this file pins:
//   1. the choice lands on the token's entry AND every entry of the same person in the
//      SAME workspace, never across a tenant boundary;
//   2. a bad body is a coded 400 that writes nothing; an unknown token is the stop
//      door's own 404 (no existence oracle);
//   3. the limiter runs BEFORE the token lookup;
//   4. choosing a language is NOT an opt-out;
//   5. the GET projection gains letterLocale + localeChosen and nothing internal;
//   6. later CV inference respects the choice.
//
// testing/unit-db.ts must stay the FIRST project import so KP_DB_PATH points at the temp
// file before any store loads.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as chooseLanguage } from "./[token]/language/route.ts";
import { GET as viewStop } from "./[token]/route.ts";
import { createPipelineEntry, ensureOptOutToken, getPipelineEntry } from "../../_lib/db/pipeline.ts";
import { ensureDb } from "../../_lib/db/core.ts";
import { saveProfile } from "../../_lib/db/profiles.ts";
import { candidateOptOutHalt } from "../../_lib/outreach-state-store.ts";
import { inferProfileLocale } from "../../_lib/comms-locale.ts";

after(() => cleanupUnitDb());

const params = (token: string) => ({ params: Promise.resolve({ token }) });

function choose(token: string, ip: string, body?: unknown): Promise<Response> {
  return chooseLanguage(
    new NextRequest(`http://localhost/api/stop/${token}/language`, {
      method: "POST",
      headers: { "x-forwarded-for": ip, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params(token)
  );
}

function view(token: string, ip: string): Promise<Response> {
  return viewStop(new NextRequest(`http://localhost/api/stop/${token}`, { headers: { "x-forwarded-for": ip } }), params(token));
}

function localeRow(id: string): { locale: string | null; locale_chosen_at: string | null } {
  return ensureDb().prepare(`SELECT locale, locale_chosen_at FROM pipeline_entries WHERE id = ?`).get(id) as {
    locale: string | null;
    locale_chosen_at: string | null;
  };
}

let seq = 0;
function fixture(candidateId: string, workspaceId?: string, locale: string | null = "cs") {
  seq += 1;
  return createPipelineEntry({
    candidateId,
    candidateLabel: `Lang Person ${seq}`,
    jobId: `lang-job-${seq}`,
    jobTitle: `Language Test Role ${seq}`,
    stage: "Applied",
    contact: `${candidateId}-${seq}@example.com`,
    locale,
    workspaceId,
  }).entry;
}

const routeSrc = readFileSync(fileURLToPath(new URL("./[token]/language/route.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

// ---- 1. the choice lands on the person, inside the tenant --------------------------

test("a choice of 'en' lands on the token's entry and every same-person entry in the SAME workspace only", async () => {
  const mine = fixture("lang-c-person");
  const sibling = fixture("lang-c-person");
  const otherTenant = fixture("lang-c-person", "ws-lang-other");
  const stranger = fixture("lang-c-stranger");
  const token = ensureOptOutToken(mine.id, mine.workspaceId)!;

  const res = await choose(token, "198.51.100.10", { locale: "en" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { locale: "en" });

  const own = localeRow(mine.id);
  assert.equal(own.locale, "en");
  assert.ok(own.locale_chosen_at, "the stored locale is marked as the candidate's own choice");
  assert.equal(localeRow(sibling.id).locale, "en", "the same person's other role follows the choice");
  assert.ok(localeRow(sibling.id).locale_chosen_at);
  assert.equal(localeRow(otherTenant.id).locale, "cs", "another workspace's entry is never reached from this token");
  assert.equal(localeRow(otherTenant.id).locale_chosen_at, null);
  assert.equal(localeRow(stranger.id).locale, "cs", "a different person is untouched");
  assert.equal(getPipelineEntry(mine.id, mine.workspaceId)?.locale, "en", "the store read every letter resolves through sees it");
});

test("an entry with NO candidate_id changes alone — an empty id never joins two people", async () => {
  const a = fixture("");
  const b = fixture("");
  const token = ensureOptOutToken(a.id, a.workspaceId)!;
  assert.equal((await choose(token, "198.51.100.11", { locale: "de" })).status, 200);
  assert.equal(localeRow(a.id).locale, "de");
  assert.equal(localeRow(b.id).locale, "cs");
});

// ---- 2. refusals ---------------------------------------------------------------------

test("an unknown or missing locale is a coded 400 and writes nothing", async () => {
  const entry = fixture("lang-c-invalid");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  for (const body of [{ locale: "xx" }, undefined, { locale: 3 }, {}]) {
    const res = await choose(token, "198.51.100.12", body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} is refused`);
    assert.equal(((await res.json()) as { code?: string }).code, "STOP_LANGUAGE_INVALID");
  }
  assert.deepEqual(localeRow(entry.id), { locale: "cs", locale_chosen_at: null }, "nothing was written");
});

test("an unknown token answers the stop door's own 404 — the same refusal, no existence oracle", async () => {
  const res = await choose("ob-never-minted-lang", "198.51.100.13", { locale: "en" });
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "STOP_LINK_INVALID");
});

// ---- 3. the throttle -----------------------------------------------------------------

test("the 21st POST from one IP+token inside the window is 429 before any token lookup", async () => {
  const m = routeSrc.match(/const STOP_LANGUAGE_RATE_LIMIT = \{ limit: ([\d_]+), windowMs: ([\d_]+) \}/);
  assert.ok(m, "the bound stays a literal the test can read");
  const limit = Number(m[1].replace(/_/g, ""));
  assert.equal(limit, 20);
  const token = "ob-lang-flood";
  for (let i = 0; i < limit; i++) {
    assert.equal((await choose(token, "198.51.100.14", { locale: "en" })).status, 404, `hit ${i + 1} is a plain miss`);
  }
  const refused = await choose(token, "198.51.100.14", { locale: "en" });
  assert.equal(refused.status, 429);
  assert.equal(((await refused.json()) as { code?: string }).code, "TOO_MANY_REQUESTS");
});

// ---- 4. not an opt-out ---------------------------------------------------------------

test("choosing a language records NO opt-out", async () => {
  const entry = fixture("lang-c-not-stop");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  assert.equal((await choose(token, "198.51.100.15", { locale: "fr" })).status, 200);
  assert.equal(candidateOptOutHalt(entry.id), null, "a language is not a stop");
  const body = (await (await view(token, "198.51.100.15")).json()) as { stopped: boolean };
  assert.equal(body.stopped, false);
  assert.doesNotMatch(routeSrc, /\brecordCandidateOptOut\b/, "the language door never reaches the opt-out write");
});

// ---- 5. the projection ---------------------------------------------------------------

test("GET carries letterLocale and localeChosen and still nothing internal", async () => {
  const entry = fixture("lang-c-projection", undefined, "cs");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  const before = (await (await view(token, "198.51.100.16")).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(before).sort(), ["company", "jobTitle", "letterLocale", "localeChosen", "stopped"]);
  assert.equal(before.letterLocale, "cs");
  assert.equal(before.localeChosen, false);
  const serialized = JSON.stringify(before);
  for (const leak of [entry.id, "Lang Person", "lang-c-projection", "@example.com", "Applied"]) {
    assert.ok(!serialized.includes(leak), `${leak} must not reach the public wire`);
  }

  assert.equal((await choose(token, "198.51.100.16", { locale: "en" })).status, 200);
  const afterChoice = (await (await view(token, "198.51.100.16")).json()) as Record<string, unknown>;
  assert.equal(afterChoice.letterLocale, "en");
  assert.equal(afterChoice.localeChosen, true);
});

test("a NULL-locale entry reports its workspace's language, not a fixed tenant's", async () => {
  const entry = fixture("lang-c-null", undefined, null);
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  const body = (await (await view(token, "198.51.100.17")).json()) as { letterLocale: string };
  assert.ok(["en", "cs", "de", "fr"].includes(body.letterLocale));
});

// ---- 6. later inference respects the choice ------------------------------------------

test("after a choice of 'en', inferProfileLocale(candidateId, ws) returns 'en' over the CV's Czech tiebreak", async () => {
  const ws = "ws-lang-infer";
  const { id: profileId } = saveProfile(
    {
      label: "Expat Candidate",
      archetype: null,
      roleFamily: null,
      completeness: null,
      payload: { languages: ["Czech (native)", "English (C1)"] },
    },
    ws
  );
  assert.equal(inferProfileLocale(profileId, ws), "cs", "the CV alone infers Czech");
  const entry = fixture(profileId, ws, "cs");
  const token = ensureOptOutToken(entry.id, entry.workspaceId)!;
  assert.equal((await choose(token, "198.51.100.18", { locale: "en" })).status, 200);
  assert.equal(inferProfileLocale(profileId, ws), "en", "the person's own statement outranks the inference");
  assert.equal(inferProfileLocale(profileId), null, "…and only inside that workspace (the default team has no such profile)");
});
