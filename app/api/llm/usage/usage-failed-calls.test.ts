import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { insertLlmUsage } from "../../../_lib/db/llm.ts";

const { NextRequest } = await import("next/server");
const { GET } = await import("./route.ts");

after(() => cleanupUnitDb());

test("usage echoes failed calls across its selected use-case window", async () => {
  insertLlmUsage({ useCase: "jd_ingest", provider: "gemini", source: "llm", outcome: "failed" });
  insertLlmUsage({ useCase: "jd_ingest", provider: "gemini", source: "llm", outcome: "ok", costUsd: 0.1 });
  insertLlmUsage({ useCase: "match_reasoning", provider: "gemini", source: "llm", outcome: "failed" });
  const read = async (query = "") => {
    const response = await GET(new NextRequest(`http://localhost/api/llm/usage${query}`));
    assert.equal(response.status, 200);
    return response.json() as Promise<{ failedCalls: number; rows: { failedCalls: number }[] }>;
  };
  const all = await read();
  assert.equal(all.failedCalls, 2);
  assert.equal(all.failedCalls, all.rows.reduce((total, row) => total + row.failedCalls, 0));
  const filtered = await read("?useCase=jd_ingest");
  assert.equal(filtered.failedCalls, 1);
});
