// ProfileDraftError must keep parseStderrError's machine code, the way
// ReasoningError already does. Dropping it left /api/profile/draft unable to
// resolve errors.invalid_input vs errors.engine_error in the reader's locale.
//
// testing/unit-db.ts MUST be the first project import — profile-draft-run.ts
// pulls llm-config (SQLite) to build KP_LLM_CONFIG even when spawn is mocked.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ProfileDraftError, runProfileDraft } from "./profile-draft-run.ts";
import { spawnPython } from "./python-runner.ts";

after(() => cleanupUnitDb());

const dir = path.dirname(fileURLToPath(import.meta.url));

test("ProfileDraftError carries the runner's machine code alongside message + status", () => {
  const err = new ProfileDraftError("boom", 400, "invalid_input");
  assert.equal(err.status, 400);
  assert.equal(err.code, "invalid_input");
  assert.equal(err.message, "boom");
});

test("empty notes are invalid_input before a spawn", async () => {
  await assert.rejects(
    () => runProfileDraft({ text: "  ", lang: "en" }),
    (e: unknown) => {
      assert.ok(e instanceof ProfileDraftError);
      assert.equal(e.status, 400);
      assert.equal(e.code, "invalid_input");
      return true;
    }
  );
});

test("a mocked non-zero spawn with code invalid_input surfaces on ProfileDraftError", async () => {
  const spawn: typeof spawnPython = () => ({
    result: Promise.resolve({
      stdout: "",
      stderr: JSON.stringify({ error: "notes too thin", status: 400, code: "invalid_input" }),
      exitCode: 1,
    }),
  });
  await assert.rejects(
    () => runProfileDraft({ text: "enough notes to draft", lang: "en" }, undefined, spawn),
    (e: unknown) => {
      assert.ok(e instanceof ProfileDraftError);
      assert.equal(e.status, 400);
      assert.equal(e.code, "invalid_input", "parseStderrError.code must survive ProfileDraftError");
      return true;
    }
  );
});

test("the throw site forwards err.code, not only message and status", () => {
  const src = readFileSync(path.join(dir, "profile-draft-run.ts"), "utf8");
  assert.match(
    src,
    /new ProfileDraftError\(\s*err\.message,\s*err\.status,\s*err\.code\s*\)/,
    "the spawn-failure throw must pass parseStderrError.code through"
  );
});
