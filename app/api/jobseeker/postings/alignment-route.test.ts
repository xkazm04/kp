// The direction the matcher read (D.3), on the wire: match_json `targetAlignment` — or a
// filtered row's as-if one — projected onto the feed's summary rows (GET /postings), the
// one-posting summary (getPostingSummary, what PATCH and the deep-dive answer) and the
// Weigh step's read (GET /postings/[id]). Isolated DB, open auth mode; unit-db.ts first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import {
  getPostingSummary,
  postingTargetAlignment,
  setPostingBlocked,
  setPostingMatch,
  setPostingStructure,
  upsertPosting,
} from "../../../_lib/db/jobseeker-postings.ts";
import type { JobseekerPostingSummary, RawPosting } from "../../../_lib/jobseeker/types.ts";
import { GET as LIST } from "./route.ts";
import { GET as ONE } from "./[id]/route.ts";

after(() => cleanupUnitDb());

let seq = 0;
function raw(): RawPosting {
  seq += 1;
  return {
    externalKey: `al-${seq}`,
    url: `https://jobs.example/al/${seq}`,
    title: `Posting ${seq}`,
    company: "Example",
    location: "Brno",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `Alignment fixture ${seq}.`,
    jsonld: null,
    lang: "en",
  };
}

const T0 = "2026-09-25T08:00:00.000Z";
const SRC = "src-align";
const V = { version: "v", matchedAt: T0 };

function stored(): string {
  const id = upsertPosting(SRC, raw(), T0).id;
  setPostingStructure(id, { id }, "deterministic");
  return id;
}

// A scored row matching a stated target title (match_cli drops None fields: no pastFamily).
const onTarget = stored();
setPostingMatch(
  onTarget,
  { total: 82, fitTier: "strong", targetAlignment: { state: "target", matchedTitle: "AI Engineer", targetFamilies: ["data_ml"] } },
  { total: 82, fitTier: "strong", ...V }
);
// A scored row that only matches where the seeker has BEEN.
const onPast = stored();
setPostingMatch(
  onPast,
  { total: 61, fitTier: "partial", targetAlignment: { state: "past", targetFamilies: ["data_ml"], pastFamily: "software_engineering" } },
  { total: 61, fitTier: "partial", ...V }
);
// A filtered row: its direction comes from the as-if result.
const gated = stored();
setPostingBlocked(
  gated,
  {
    blocked: { koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"] },
    asIf: { total: 70, targetAlignment: { state: "family", matchedTitle: null, targetFamilies: ["data_ml"], pastFamily: "software_engineering" } },
  },
  V
);
// No target stated: the matcher sends no targetAlignment at all.
const noTarget = stored();
setPostingMatch(noTarget, { total: 55, fitTier: "partial" }, { total: 55, fitTier: "partial", ...V });
// Unreadable: a state outside the vocabulary is no alignment, never a throw.
const junk = stored();
setPostingMatch(junk, { total: 50, fitTier: "partial", targetAlignment: { state: "sideways" } }, { total: 50, fitTier: "partial", ...V });

const list = async () =>
  (await (await LIST(new Request("http://localhost/api/jobseeker/postings?status=all&limit=100"))).json()) as { rows: JobseekerPostingSummary[] };

test("the feed rows carry the direction the matcher read, a filtered row's from its as-if result", async () => {
  const byId = new Map((await list()).rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.get(onTarget)!.targetAlignment, { state: "target", matchedTitle: "AI Engineer", targetFamilies: ["data_ml"], pastFamily: null });
  assert.deepEqual(byId.get(onPast)!.targetAlignment, { state: "past", matchedTitle: null, targetFamilies: ["data_ml"], pastFamily: "software_engineering" });
  assert.deepEqual(byId.get(gated)!.targetAlignment, { state: "family", matchedTitle: null, targetFamilies: ["data_ml"], pastFamily: "software_engineering" });
  assert.equal(byId.get(noTarget)!.targetAlignment, null, "no target stated: null, not a default");
  assert.equal(byId.get(junk)!.targetAlignment, null);
});

test("the one-posting summary carries it (what PATCH and the deep-dive answer)", () => {
  assert.equal(getPostingSummary(onTarget)!.targetAlignment?.matchedTitle, "AI Engineer");
  assert.equal(getPostingSummary(gated)!.targetAlignment?.state, "family");
  assert.equal(getPostingSummary(noTarget)!.targetAlignment, null);
});

test("GET /postings/[id] carries it beside the detail view", async () => {
  const res = await ONE(new Request(`http://localhost/api/jobseeker/postings/${onPast}`), { params: Promise.resolve({ id: onPast }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { targetAlignment: JobseekerPostingSummary["targetAlignment"] };
  assert.equal(body.targetAlignment?.state, "past");
  assert.equal(body.targetAlignment?.pastFamily, "software_engineering");
  const none = await ONE(new Request(`http://localhost/api/jobseeker/postings/${noTarget}`), { params: Promise.resolve({ id: noTarget }) });
  assert.equal(((await none.json()) as { targetAlignment: unknown }).targetAlignment, null);
});

test("postingTargetAlignment: unmatched rows and non-object payloads read null", () => {
  assert.equal(postingTargetAlignment(null), null);
  assert.equal(postingTargetAlignment({ targetAlignment: "target" }), null);
  assert.equal(postingTargetAlignment({ blocked: { koKeys: ["language"] }, asIf: null }), null);
  assert.deepEqual(postingTargetAlignment({ targetAlignment: { state: "none", targetFamilies: ["a", 3, ""] } }), {
    state: "none",
    matchedTitle: null,
    targetFamilies: ["a"],
    pastFamily: null,
  });
});
