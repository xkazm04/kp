// /api/sim/offer-link hands back an OFFER CAPABILITY TOKEN, and `/api/offer/<token>`
// is a PUBLIC route whose POST accepts or declines on the candidate's behalf. The
// route used to resolve that token with a bare `getOpenOfferForEntry(entryId)` — no
// workspace, no operator gate — while its four sibling sim routes all scope the
// lookup to `currentWorkspace()` and say so explicitly ("the scoping doubles as the
// authorization check, since a stranger's entryId simply doesn't resolve").
//
// That mattered because entry ids are DERIVED, not secret: createPipelineEntry builds
// `m-<candidateId>-<jobId>` on the default team. So any caller the proxy admits —
// including the anonymous demo-workspace session /api/demo mints, and any other team's
// member once KP_MULTI_WORKSPACE is on — could exchange a computed id for another
// tenant's live offer link and answer the offer for them.
//
// Two halves, the shape this directory already uses:
//   (1) BEHAVIOUR — the unscoped helper really does hand the row to anyone, and the
//       workspace-scoped entry read is what refuses a caller from another team.
//   (2) SOURCE GUARD — the route actually performs that read before returning a token.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { createPipelineEntry, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { createOffer, getOpenOfferForEntry } from "@/app/_lib/offers-store";

after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

const OWNER_WS = "team-offer-owner";
const STRANGER_WS = "team-stranger";

test("the offer token is reachable from ANY team through the unscoped helper — the entry read is the gate", () => {
  const { entry } = createPipelineEntry({
    candidateId: "offer-link-cand",
    candidateLabel: "Real Candidate",
    jobId: "offer-link-job",
    jobTitle: "Backend Engineer",
    workspaceId: OWNER_WS,
    stage: "Offer",
  });
  createOffer({
    entryId: entry.id,
    candidateLabel: "Real Candidate",
    jobId: "offer-link-job",
    jobTitle: "Backend Engineer",
    currency: "CZK",
    salary: 140000,
    payload: null,
  });

  // The helper the route calls is workspace-blind by design (it takes no workspace
  // at all), so it happily returns the live capability token for a row that belongs
  // to another tenant. Nothing about the token itself is scoped.
  const offer = getOpenOfferForEntry(entry.id);
  assert.ok(offer?.token, "precondition: an open offer with a live token exists");
  assert.equal(offer.workspaceId, OWNER_WS, "the offer inherited the entry's tenant at mint");

  // The workspace-scoped entry read IS the authorization: it resolves for the owning
  // team and refuses everyone else, which is what turns the route into a 404 instead
  // of a token disclosure.
  assert.ok(getPipelineEntry(entry.id, OWNER_WS), "the owning team resolves its own entry");
  assert.equal(getPipelineEntry(entry.id, STRANGER_WS), null, "another team's session must not resolve it");
});

test("the route authorizes the entry in the caller's workspace before returning a token", () => {
  assert.match(src, /import \{ currentWorkspace \}/, "the caller's tenant must be read from the session");
  assert.match(
    src,
    /getPipelineEntry\(entryId, workspaceId\)/,
    "the entry is looked up in the CALLER'S team — the scoping doubles as the authorization check"
  );
  assert.match(src, /status: 404/, "an entry outside the caller's team is a 404, not a token");
  // And the token may only ride out after that check — never straight off the
  // workspace-blind helper.
  assert.doesNotMatch(
    src,
    /token:\s*offer\?\.token\s*\?\?\s*null/,
    "the bare unscoped `offer?.token ?? null` return must not come back"
  );
});
