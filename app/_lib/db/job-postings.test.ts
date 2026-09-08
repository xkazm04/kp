// The posting corpus store: the seed mark really is one-shot, the content hash really
// de-duplicates, and distinctRolePostings really returns a STRATIFIED sample (the
// property the intake studio depends on — fifty flavours of "developer" would make the
// sample worthless even though every row is distinct).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  distinctRolePostings,
  getJobPosting,
  insertJobPosting,
  listJobPostings,
  postingContentHash,
  seedJobBody,
  seedJobPostingsCorpus,
} from "./job-postings.ts";

after(() => cleanupUnitDb());

const WS = "ws-postings";

test("the bundled corpora import once, and a second call is a no-op (seed mark, never COUNT(*))", () => {
  const first = seedJobPostingsCorpus(WS);
  // 100 calibration + 120 seed_jobs, minus whatever the content hash collapses.
  assert.ok(first.inserted > 180, `expected the whole corpus, imported ${first.inserted}`);
  assert.equal(first.inserted + first.skipped, 220, "every corpus record is accounted for");

  const second = seedJobPostingsCorpus(WS);
  assert.deepEqual(second, { inserted: 0, skipped: 0 }, "the mark, not a row count, decides");

  // …and the ledger still holds exactly what the first run wrote.
  assert.equal(listJobPostings(WS, { limit: 500 }).length, first.inserted);
});

test("the list projection carries no body and no tenant id, and filters on q + role family", () => {
  const all = listJobPostings(WS, { limit: 500 });
  const one = all[0] as Record<string, unknown>;
  assert.ok(!("bodyText" in one) && !("contentHash" in one) && !("workspaceId" in one));
  assert.ok((one.bodyChars as number) > 0, "the body's size survives even though the body does not");

  const family = all.find((p) => p.roleFamily)?.roleFamily as string;
  const filtered = listJobPostings(WS, { roleFamily: family, limit: 500 });
  assert.ok(filtered.length > 0 && filtered.every((p) => p.roleFamily === family));

  // Case-insensitive title/company match.
  const title = all[0].title;
  const hit = listJobPostings(WS, { q: title.toUpperCase().slice(0, 6), limit: 500 });
  assert.ok(hit.some((p) => p.id === all[0].id), "an upper-cased fragment of a title still matches");
});

test("distinctRolePostings returns n rows, n distinct titles, and spans the taxonomy", () => {
  const sample = distinctRolePostings(WS, 50);
  assert.equal(sample.length, 50);
  const titles = new Set(sample.map((p) => p.title.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()));
  assert.equal(titles.size, 50, "one posting per role — no normalized title appears twice");
  // The two bundled corpora between them carry ELEVEN of the taxonomy's sixteen role
  // families (data/taxonomy.json) — there is no construction/manufacturing, healthcare,
  // education, public-sector or skilled-trades advertisement in either file — so eleven
  // is the ceiling this sample can reach, and reaching it is the property worth pinning:
  // the round-robin must not spend all fifty picks on software_engineering (60 of the
  // 220 rows) and data_ai (34).
  const families = new Set(sample.map((p) => p.roleFamily ?? "~unknown"));
  assert.ok(families.size >= 10, `expected a stratified sample across the corpus, got ${families.size} families`);
  // Deterministic: the same corpus and the same n produce the same rows in the same order.
  assert.deepEqual(distinctRolePostings(WS, 50).map((p) => p.id), sample.map((p) => p.id));
});

test("the content hash de-duplicates a re-import, and hands back the row already stored", () => {
  const body = "  We are hiring a Staff Platform Engineer.\n\nYou will own the deployment pipeline.  ";
  const first = insertJobPosting({ source: "paste", title: "Staff Platform Engineer", bodyText: body }, "ws-hash");
  assert.equal(first.inserted, true);
  // Same advertisement, different whitespace and case — one row, and the EXISTING id.
  const again = insertJobPosting(
    { source: "url", title: "Staff Platform Engineer", bodyText: body.toUpperCase().replace(/\n/g, "  ") },
    "ws-hash"
  );
  assert.equal(again.inserted, false);
  assert.equal(again.id, first.id);
  assert.equal(listJobPostings("ws-hash", { limit: 100 }).length, 1);

  // The UNIQUE is per workspace: another team importing the same ad is not a duplicate.
  const other = insertJobPosting({ source: "paste", title: "Staff Platform Engineer", bodyText: body }, "ws-hash-2");
  assert.equal(other.inserted, true);
  assert.equal(postingContentHash(body), postingContentHash(body.toUpperCase().replace(/\n/g, "  ")));
});

test("a stored posting round-trips whole, body included", () => {
  const { id } = insertJobPosting(
    {
      source: "url",
      sourceRef: "https://example.test/jobs/1",
      title: "Data Engineer",
      company: "Example",
      roleFamily: "data",
      seniority: "senior",
      lang: "en",
      bodyText: "A body long enough to matter.",
      fetchedAt: "2026-09-08T00:00:00.000Z",
    },
    "ws-roundtrip"
  );
  const posting = getJobPosting(id, "ws-roundtrip");
  assert.equal(posting?.source, "url");
  assert.equal(posting?.sourceRef, "https://example.test/jobs/1");
  assert.equal(posting?.company, "Example");
  assert.equal(posting?.fetchedAt, "2026-09-08T00:00:00.000Z");
  assert.equal(posting?.bodyText, "A body long enough to matter.");
});

test("a seed_jobs body is the advertisement a candidate reads: description then the bullets", () => {
  const body = seedJobBody({ description: "Join us.", requirements: ["Java", "Kafka"] });
  assert.equal(body, "Join us.\n\nRequirements:\n- Java\n- Kafka");
  assert.equal(seedJobBody({ description: "Join us.", requirements: [] }), "Join us.");
});
