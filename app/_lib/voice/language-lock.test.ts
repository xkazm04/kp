// Runtime language-lock verdict + PARITY with the Python offline check. The
// fixtures in pipeline/jobfit/eval/language_lock_fixtures.json are shared with
// test_interview_eval.py: this side asserts the trichotomy verdict + drift index;
// the Python side asserts its offline _check_language_consistency flags exactly the
// cases marked "drifted". Keeping both green keeps the ported word lists in sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clearLang, detectLanguageLock } from "./language-lock.ts";
import type { VoiceTurn } from "./types.ts";

const fixturePath = fileURLToPath(new URL("../../../pipeline/jobfit/eval/language_lock_fixtures.json", import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  cases: { name: string; expect: string; driftTurnIndex: number | null; turns: VoiceTurn[] }[];
};

for (const c of fixtures.cases) {
  test(`language-lock fixture: ${c.name} → ${c.expect}`, () => {
    const res = detectLanguageLock(c.turns);
    assert.equal(res.verdict, c.expect, `${c.name}: verdict`);
    assert.equal(res.driftTurnIndex, c.driftTurnIndex, `${c.name}: driftTurnIndex`);
  });
}

test("clearLang: unambiguous cs/en, null on bilingual or empty", () => {
  assert.equal(clearLang("How was that project for you?"), "en");
  assert.equal(clearLang("Děkuji, můžeme prosím začít."), "cs");
  assert.equal(clearLang("Dobrý den, hello and welcome."), null); // both markers
  assert.equal(clearLang("Mmm."), null); // neither
});

test("system turns are ignored and do not shift the drift index", () => {
  const turns: VoiceTurn[] = [
    { role: "system", text: "session started" },
    { role: "interviewer", text: "Hi, this call is transcribed for a recruiter." },
    { role: "candidate", text: "Thank you, I can tell you about my experience." },
    { role: "interviewer", text: "Dobře, řekněte mi prosím o vašem projektu." },
  ];
  const res = detectLanguageLock(turns);
  assert.equal(res.verdict, "drifted");
  // Index is into the non-system turns: opener 0, candidate 1, drift 2.
  assert.equal(res.driftTurnIndex, 2);
});

test("empty transcript is indeterminate, not a crash", () => {
  assert.deepEqual(detectLanguageLock([]), { verdict: "indeterminate", driftTurnIndex: null });
});
