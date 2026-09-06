// Contract: every TS module that spawns a Python CLI which resolves an LLM use
// case (resolve_provider on the Python side) must pass `env: buildLlmConfigEnv()`
// on the spawn — otherwise the admin's BYOM provider/key re-route silently never
// reaches the child and the site runs on the built-in default forever. The
// 2026-08-05 coverage sweep found FOUR sites in exactly that state (jd_ingest,
// weight_proposal, group_compare, profile_draft); this test pins the fix the same
// way rate-limit-contract.test.ts pins limiter call sites. Adding a new LLM spawn
// site means adding it here deliberately.
//
// 2026-09-05: a second sweep found a FIFTH site in that state, and the most
// expensive one — `_lib/analyze-run.ts`, the flagship CV analysis. Its child
// calls resolve_provider("cv_analysis") (pipeline/jobfit/pipeline.py) while the
// spawn passed no env, so every Models-panel `cv_analysis` row and every BYOM key
// was inert on the one path that runs on every candidate.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { buildLlmConfigEnv } from "./llm-config.ts";
import { upsertLlmConfig } from "./db/llm.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// module → the use case(s) its Python CLI resolves. Deterministic-only spawn
// wrappers (profile_cli, extract_cli, match_cli, matrix_cli, winnability_cli)
// are intentionally absent.
const LLM_SPAWN_MODULES: Record<string, string> = {
  "_lib/analyze-run.ts": "cv_analysis",
  "_lib/reasoning-run.ts": "match_reasoning",
  "_lib/automation-run.ts": "automation / interview_scorecard",
  "_lib/devcase-run.ts": "devcase_*",
  "_lib/agent-hire/transform-run.ts": "agent_fit",
  "_lib/repo-scan-run.ts": "repo_scan",
  "_lib/job-ingest.ts": "jd_ingest",
  "_lib/recruiter-run.ts": "weight_proposal",
  "_lib/group-eval-run.ts": "group_compare",
  "_lib/jd-build-run.ts": "grounded_salary (env inert today — direct gemini.py path)",
  // Background-mode round (2026-08-12): campaign + profile-draft spawns moved out
  // of their route bodies into shared runners so the task kinds reuse them; the
  // routes are thin sync wrappers now and the env contract rides the runner.
  "_lib/campaign-run.ts": "campaign_pack",
  "_lib/profile-draft-run.ts": "profile_draft",
  "api/llm/test/route.ts": "any (canary)",
};

// DELIBERATE EXCLUSION: api/llm/keys/test/route.ts also spawns test_cli, but with
// buildProviderKeyProbeEnv(provider, scope) instead — a config carrying ONE key
// row and no routing. That is the point of it: buildLlmConfigEnv applies the
// byom-over-platform precedence, so probing a platform row through it would be
// silently answered by the BYOM key above it and report a pass for a credential
// that was never called. Adding it to the map above would assert the wrong
// contract, not a missing one.

for (const [rel, useCase] of Object.entries(LLM_SPAWN_MODULES)) {
  test(`${rel} passes buildLlmConfigEnv to its LLM spawn (${useCase})`, () => {
    const source = readFileSync(path.join(APP_ROOT, rel), "utf-8");
    assert.match(
      source,
      /buildLlmConfigEnv/,
      `${rel} spawns an LLM-resolving Python CLI but never passes buildLlmConfigEnv() — ` +
        "the configured BYOM provider/key re-route is dead for its use case."
    );
  });
}

after(() => cleanupUnitDb());

// The static assertion above proves the identifier is PRESENT; this one proves the
// flagship spawn's option object actually carries it. `env` had to be added beside
// `timeoutMs` on that call — a `buildLlmConfigEnv` mentioned only in a comment
// would satisfy a regex and route nothing.
test("_lib/analyze-run.ts passes the env on the spawn itself, not merely imports it", () => {
  const source = readFileSync(path.join(APP_ROOT, "_lib/analyze-run.ts"), "utf-8");
  const call = /spawnPython\(\s*cliArgs\([^)]*\),\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  assert.ok(call, "the analyze spawn call site moved — re-pin this contract");
  assert.match(
    call[1],
    /env:\s*buildLlmConfigEnv\(\)/,
    "the analyze spawn's options must carry env: buildLlmConfigEnv() — without it the " +
      "child's resolve_provider(\"cv_analysis\") sees no KP_LLM_CONFIG and the operator's " +
      "Models routing row plus any BYOM key are silently inert."
  );
});

// …and that the env it builds actually ROUTES cv_analysis: the use case must survive
// into KP_LLM_CONFIG with its provider AND its model pin, since the child reads the
// model off the resolved provider (pipeline.py: `getattr(cv_provider, "model", None)`).
test("a cv_analysis routing row reaches the child through KP_LLM_CONFIG", () => {
  upsertLlmConfig({ useCase: "cv_analysis", provider: "openai", model: "gpt-5-vision" });
  const env = buildLlmConfigEnv();
  assert.ok(env.KP_LLM_CONFIG, "a configured row must produce the env var");
  const parsed = JSON.parse(env.KP_LLM_CONFIG) as {
    useCases: Record<string, { provider: string; model?: string }>;
  };
  assert.equal(parsed.useCases.cv_analysis?.provider, "openai");
  assert.equal(parsed.useCases.cv_analysis?.model, "gpt-5-vision", "the model pin must survive too");
});
