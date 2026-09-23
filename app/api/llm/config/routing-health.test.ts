// GET /api/llm/config now answers "what SERVED each use case since its pin was set",
// not only "what is pinned". The read is cut per use case at max(window start,
// effective pin updatedAt) — a re-pin is never credited with the traffic of the
// provider it replaced — and it carries only catalogued use cases: ledger-only ids
// (key_probe, the keys canary) have no routing row to report on.
//
// Same gate as before (requireOperator) and the same reach as the Activity and
// usage routes beside it: llm_usage is deployment-wide and tenancy-exempt, and
// this is an aggregate of what those routes already list row by row.
//
// unit-db.ts must stay the first project import (isolated throwaway DB; it also
// clears KP_OPERATOR_PASSWORD -> open mode, so requireOperator admits the caller).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET } from "./route.ts";
import { insertLlmUsage, upsertLlmConfig } from "../../../_lib/db/llm.ts";
import type { RoutingHealthRow } from "../../../_lib/db/llm-routing-health.ts";
import { LLM_PROVIDERS, LLM_USE_CASES } from "../../../_lib/llm-config.ts";

after(() => cleanupUnitDb());

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

type Payload = {
  rows: Array<{ useCase: string }>;
  providers: string[];
  useCases: string[];
  health: Record<string, RoutingHealthRow>;
};

test("7 GET carries per-use-case health, cut at each pin, catalogue ids only", async () => {
  // Traffic BEFORE the pins: claude_cli served both use cases.
  insertLlmUsage({ useCase: "match_reasoning", provider: "claude_cli", source: "llm", outcome: "ok" });
  insertLlmUsage({ useCase: "automation", provider: "claude_cli", source: "llm", outcome: "ok" });
  await tick();
  upsertLlmConfig({ useCase: "match_reasoning", provider: "gemini", model: "m" });
  upsertLlmConfig({ useCase: "automation", provider: "openai", model: null });
  await tick();
  // After the pins: gemini serves match_reasoning twice, then a template serve.
  insertLlmUsage({ useCase: "match_reasoning", provider: "gemini", model: "m", source: "llm", outcome: "ok" });
  insertLlmUsage({ useCase: "match_reasoning", provider: "gemini", model: "m", source: "llm", outcome: "ok" });
  await tick();
  insertLlmUsage({ useCase: "match_reasoning", provider: "deterministic", source: "deterministic", outcome: "ok", reason: "missing_key" });
  // Unpinned, served by gemini (Default resolved to it).
  insertLlmUsage({ useCase: "cv_analysis", provider: "gemini", model: "flash", source: "llm", outcome: "ok" });
  // Ledger-only use case outside the routing catalogue.
  insertLlmUsage({ useCase: "key_probe", provider: "openai", source: "llm", outcome: "ok" });

  const r = await GET();
  assert.equal(r.status, 200);
  const body = (await r.json()) as Payload;

  // The existing payload is unchanged.
  assert.deepEqual(body.providers, [...LLM_PROVIDERS]);
  assert.deepEqual(body.useCases, [...LLM_USE_CASES]);
  assert.deepEqual(body.rows.map((row) => row.useCase).sort(), ["automation", "match_reasoning"]);

  const mr = body.health.match_reasoning;
  assert.ok(mr, "a pinned use case with traffic since its pin has a health row");
  assert.equal(mr.llmOk, 2, "the pre-pin claude_cli serve is NOT credited to the gemini pin");
  assert.equal(mr.deterministic, 1);
  assert.equal(mr.failed, 0);
  assert.equal(mr.last.source, "deterministic");
  assert.equal(mr.last.reason, "missing_key");
  assert.deepEqual({ provider: mr.lastServed?.provider, model: mr.lastServed?.model }, { provider: "gemini", model: "m" });

  assert.equal(body.health.automation, undefined, "only pre-pin traffic -> no row (the client reads it as unproven)");
  assert.equal(body.health.cv_analysis?.lastServed?.provider, "gemini");
  assert.equal(body.health.key_probe, undefined, "ledger-only use cases are not routing rows");
  assert.equal(body.health["*"], undefined);
});
