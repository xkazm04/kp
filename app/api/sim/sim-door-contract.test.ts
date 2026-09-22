// The sim doors' "writes only the demo corpus" exemption, made a property of the code.
//
// route-capability-coverage.test.ts exempts the guided-sim routes from the capability
// ratchet because they touch only the (SIM)-marked demo corpus. Three of them used to
// read an entry by id with the raw store accessor, so any signed-in seat could:
//   - overwrite a REAL candidate's pending screening/offer approval with the sim's
//     canned draft (and "Send offer" would then mail it through the real channel,
//     since comms dispatch only diverts (SIM) titles), and
//   - read a REAL candidate's open offer token, which the public /api/offer/<token>
//     door accepts or declines on the candidate's behalf.
//
// Two halves:
//   (1) BEHAVIOUR — the real handlers, on a throwaway DB, refuse a real entry with
//       SIM_ENTRY_NOT_FOUND 404 and leave its row byte-identical; a (SIM) entry works.
//   (2) CONTRACT — no app/api/sim/**/route.ts imports the raw by-id accessors; every
//       by-id entry read goes through resolveSimEntry (app/_lib/sim-entry.ts).
//
// With no Next request scope, `cookies()` throws and currentWorkspace() degrades to the
// default workspace, so every fixture lives there.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { POST: screenDraft } = await import("./screen-draft/route.ts");
const { POST: offerDraft } = await import("./offer-draft/route.ts");
const { GET: offerLink } = await import("./offer-link/route.ts");
const { createPipelineEntry, getPipelineEntry, setApproval } = await import("../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
const { createOffer } = await import("../../_lib/offers-store.ts");
const { markSimTitle } = await import("../../features/shell/simulation/constants.ts");

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;
const HERE = path.dirname(fileURLToPath(import.meta.url));

function post(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}
function get(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

function entry(candidateId: string, jobTitle: string, stage = "Interview"): string {
  const { entry: e } = createPipelineEntry({
    candidateId,
    candidateLabel: `Candidate ${candidateId}`,
    jobId: `job-door-${candidateId}`,
    jobTitle,
    workspaceId: WS,
    stage,
  });
  return e.id;
}

function approvalOf(id: string): [unknown, unknown] {
  const e = getPipelineEntry(id, WS);
  assert.ok(e, "fixture entry exists");
  return [e.approvalKind, e.approvalDetail];
}

test("offer-draft on a REAL entry is a 404 and its approval is byte-identical", async () => {
  const id = entry("door-real-offer", "Backend Engineer", "Offer");
  setApproval(id, "offer_review", JSON.stringify({ salary: 150000, note: "the recruiter's own draft" }), WS);
  const before = approvalOf(id);

  const res = await offerDraft(post("http://x/api/sim/offer-draft", { entryId: id }));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "SIM_ENTRY_NOT_FOUND");
  assert.deepEqual(approvalOf(id), before);
});

test("screen-draft on a REAL entry with a pending approval is a 404 and does not overwrite it", async () => {
  const id = entry("door-real-screen", "Backend Engineer");
  setApproval(id, "calendar", "Wed 10:00", WS);
  const before = approvalOf(id);

  const res = await screenDraft(post("http://x/api/sim/screen-draft", { entryId: id }));
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code?: string }).code, "SIM_ENTRY_NOT_FOUND");
  assert.deepEqual(approvalOf(id), before);
});

test("screen-draft on a (SIM) entry is a 200 and sets screening_review", async () => {
  const id = entry("door-sim-screen", markSimTitle("Backend Engineer"));
  const res = await screenDraft(post("http://x/api/sim/screen-draft", { entryId: id }));
  assert.equal(res.status, 200);
  assert.equal(approvalOf(id)[0], "screening_review");
});

test("offer-draft on a (SIM) entry is a 200 and sets offer_review", async () => {
  const id = entry("door-sim-offer", markSimTitle("Backend Engineer"), "Offer");
  const res = await offerDraft(post("http://x/api/sim/offer-draft", { entryId: id }));
  assert.equal(res.status, 200);
  assert.equal(approvalOf(id)[0], "offer_review");
});

function openOffer(id: string): string {
  const e = getPipelineEntry(id, WS);
  assert.ok(e);
  const offer = createOffer({
    entryId: id,
    candidateLabel: e.candidateLabel,
    jobId: e.jobId,
    jobTitle: e.jobTitle,
    currency: "CZK",
    salary: 140000,
    payload: null,
  });
  return offer.token;
}

test("offer-link for a REAL entry with an open offer is a 404 with no token in the body", async () => {
  const id = entry("door-real-link", "Backend Engineer", "Offer");
  const token = openOffer(id);
  const res = await offerLink(get(`http://x/api/sim/offer-link?entryId=${encodeURIComponent(id)}`));
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.ok(!text.includes(token), "the real candidate's capability token must not ride out");
  assert.equal((JSON.parse(text) as { code?: string }).code, "SIM_ENTRY_NOT_FOUND");
});

test("offer-link for a (SIM) entry with an open offer is a 200 carrying its token", async () => {
  const id = entry("door-sim-link", markSimTitle("Backend Engineer"), "Offer");
  const token = openOffer(id);
  const res = await offerLink(get(`http://x/api/sim/offer-link?entryId=${encodeURIComponent(id)}`));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { token: string | null }).token, token);
});

// ── (2) CONTRACT ─────────────────────────────────────────────────────────────
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const RAW_BY_ID = ["getPipelineEntry", "setApproval", "getOpenOfferForEntry"];

test("no sim route imports the raw by-id accessors; entry reads go through resolveSimEntry", () => {
  const routes = routeFiles(HERE);
  assert.ok(routes.length >= 6, `expected the six sim routes, found ${routes.length}`);
  const offenders: string[] = [];
  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    // Every import clause, including multi-line ones.
    for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      for (const raw of RAW_BY_ID) {
        if (names.includes(raw)) offenders.push(`${path.relative(HERE, file)} imports ${raw}`);
      }
    }
    // A namespace import would dodge the clause scan; forbid the call shape too.
    for (const raw of RAW_BY_ID) {
      if (new RegExp(`\\.${raw}\\(`).test(src)) offenders.push(`${path.relative(HERE, file)} calls .${raw}(`);
    }
  }
  assert.deepEqual(offenders, [], "a sim route must read entries by id only through resolveSimEntry");
});

test("each sim route that takes an entryId resolves it through resolveSimEntry", () => {
  for (const file of routeFiles(HERE)) {
    const src = readFileSync(file, "utf8");
    // Routes that READ an entry id from the caller (body or query) — not ones that
    // merely echo a freshly created entry's id back (apply-cv, inbound).
    if (!/(\{\s*entryId\s*\}|get\("entryId"\))/.test(src)) continue;
    assert.match(
      src,
      /resolveSimEntry\(entryId, (?:await currentWorkspace\(\)|workspaceId)\)/,
      `${path.relative(HERE, file)} takes an entryId, so it must resolve it through resolveSimEntry`
    );
    assert.match(src, /jsonRefusal\("SIM_ENTRY_NOT_FOUND", 404\)/, `${path.relative(HERE, file)} answers the one refusal`);
  }
});
