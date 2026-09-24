// The Insights → Activity read surface had no test at all: the route that serves
// the row-level llm_usage window, and — more consequentially — the SENTENCE above
// the table.
//
// `llm_usage` has no org or workspace column (tenancy-exempt config/metering), so
// the ledger is DEPLOYMENT-wide. The tab said "the last N AI actions this workspace
// ran" in all four languages: not an omission, a claim, and a wrong one on any
// install with more than one team. The billing panel two tabs over answers the same
// scope question correctly (`billing.spend.breakdownScope`), so the two surfaces now
// say it with the SAME words in every locale — pinned below, because a copy edit to
// one of them is exactly how the pair drifted apart in the first place.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB; it also
// clears KP_OPERATOR_PASSWORD → open mode, so requireOperator admits the caller).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { NextRequest } from "next/server";
import { GET } from "./route.ts";
import { insertLlmUsage, LLM_ACTIVITY_WINDOW } from "../../../_lib/db/llm.ts";

after(() => cleanupUnitDb());

const catalog = (locale: string): Record<string, Record<string, string>> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../messages/${locale}.json`, import.meta.url)), "utf8"));

const request = (query = "") => new NextRequest(`http://localhost/api/llm/activity${query}`);

test("GET returns the bounded newest-first window and says how big it is", async () => {
  const r = await GET(request());
  assert.equal(r.status, 200);
  const body = (await r.json()) as { rows: unknown[]; window: number };
  assert.equal(body.window, LLM_ACTIVITY_WINDOW, "the client renders this number in the intro sentence");
  assert.ok(Array.isArray(body.rows));
});

test("GET serves the ledger rows, newest first", async () => {
  // The store stamps `ts` itself; the window is ordered `ts DESC, id DESC`, so the
  // later insert is the newer row even inside one millisecond.
  insertLlmUsage({ useCase: "match_reasoning", provider: "gemini", model: "flash", source: "llm", outcome: "ok" });
  insertLlmUsage({ useCase: "jd_build", provider: "claude_cli", model: null, source: "llm", outcome: "ok" });

  const body = (await (await GET(request())).json()) as { rows: Array<{ useCase: string; provider: string }> };
  assert.ok(body.rows.length >= 2);
  assert.equal(body.rows[0].useCase, "jd_build", "newest first");
  assert.equal(body.rows[1].provider, "gemini");
});

test("GET filters before its window and pages from a row cursor", async () => {
  insertLlmUsage({ useCase: "jd_ingest", provider: "gemini", source: "llm", outcome: "failed" });
  insertLlmUsage({ useCase: "profile_draft", provider: "gemini", source: "llm", outcome: "ok" });
  const filtered = await GET(request("?useCase=jd_ingest&outcome=failed"));
  const filteredBody = (await filtered.json()) as { rows: Array<{ useCase: string; outcome: string }> };
  assert.equal(filtered.status, 200);
  assert.equal(filteredBody.rows.length, 1);
  assert.equal(filteredBody.rows[0].useCase, "jd_ingest");
  assert.equal(filteredBody.rows[0].outcome, "failed");

  const all = (await (await GET(request())).json()) as { rows: Array<{ id: number; ts: string }> };
  const wildcard = (await (await GET(request("?useCase=*"))).json()) as { rows: Array<{ id: number }> };
  assert.deepEqual(wildcard.rows.map((row) => row.id), all.rows.map((row) => row.id));
  const first = all.rows[0];
  const cursor = encodeURIComponent(`${first.ts}|${first.id}`);
  const older = (await (await GET(request(`?cursor=${cursor}`))).json()) as { rows: Array<{ id: number }> };
  assert.ok(older.rows.length > 0);
  assert.ok(older.rows.every((row) => row.id !== first.id));
});

test("GET refuses unknown filters and malformed cursors with a code", async () => {
  for (const query of ["?useCase=made_up", "?outcome=maybe", "?cursor=bad", "?cursor=2026-01-01T00%3A00%3A00.000Z%7C0"]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, "LLM_ACTIVITY_QUERY_INVALID");
  }
});

// The scope sentence, in every language. The shared phrase is the contract: both
// surfaces read the same ledger, so both must name the same boundary.
const SCOPE_PHRASE: Record<string, string> = {
  en: "every workspace on this deployment",
  cs: "všemi pracovními prostory této instalace",
  de: "alle Arbeitsbereiche dieser Installation",
  fr: "tous les espaces de travail de ce déploiement",
};

for (const [locale, phrase] of Object.entries(SCOPE_PHRASE)) {
  test(`${locale}: the Activity intro and the billing breakdown name the same scope`, () => {
    const messages = catalog(locale) as unknown as {
      activity: { intro: string };
      billing: { spend: { breakdownScope: string } };
    };
    assert.ok(
      messages.activity.intro.includes(phrase),
      `activity.intro must state the deployment-wide scope: ${messages.activity.intro}`
    );
    assert.ok(
      messages.billing.spend.breakdownScope.includes(phrase),
      `billing.spend.breakdownScope must keep the same wording: ${messages.billing.spend.breakdownScope}`
    );
    assert.ok(
      messages.activity.intro.includes("{window}"),
      "the window size stays in the sentence — the tab says how much it is showing"
    );
  });
}

test("en: the Activity intro no longer claims a per-workspace ledger", () => {
  // The exact regression: a table over a column-less ledger described as this
  // workspace's. Guarded on en only — it is the source of truth the others follow.
  assert.ok(!/this workspace ran/i.test(catalog("en").activity.intro as unknown as string));
});
