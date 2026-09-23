// Resume and the cast (challenge-r03 interview-simulator/B): a dump records the digest of
// the situation it ran, and a rerun into the same directory re-plays a situation whose
// persona, first line, provocations or required response changed since — the instrument
// alone is not the identity of a conversation (registry: prompt-change-regression-baseline,
// "the cast, byte-exact"). On a hand-built instrument and the keyless fakes: no database
// write, no model.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TEST_AGENDA, testSituation } from "./dump-builder.ts";
import type { SimConversationDump } from "./engine.ts";
import { fakeCandidate, fakeInterviewer } from "./fake.ts";
import type { SimInstrument } from "./instrument.ts";
import { runSimulations } from "./runner.ts";
import { situationSha } from "./situations.ts";
import type { SimFixture, SimSituation } from "./types.ts";

const out = mkdtempSync(path.join(tmpdir(), "kp-sim-resume-"));
after(() => {
  rmSync(out, { recursive: true, force: true });
  cleanupUnitDb();
});

const instrument = (fixture: SimFixture, locale: string | null): SimInstrument => ({
  key: `${fixture}.${locale ?? "auto"}`,
  fixture,
  locale,
  branch: "kit",
  agenda: TEST_AGENDA,
  privateBrief: "You are a test interviewer. Ask one question at a time.",
  candidateBrief: null,
  record: { briefSha: "sha256:brief-fixed", agendaBlockIds: TEST_AGENDA.blocks.map((b) => b.id), directorVersion: "sha256:director-fixed" },
  seeded: { jobId: "job-test", entryId: null, kitId: null },
});

test("situationSha: stable, and moved by every field that shapes the conversation", () => {
  const s = testSituation({ firstMessage: "Hi." });
  assert.match(situationSha(s), /^sha256:[0-9a-f]{64}$/);
  assert.equal(situationSha(s), situationSha({ ...s }), "stable");
  const renamed: SimSituation = { ...s, title: "renamed", behaviour: "relabelled" };
  assert.equal(situationSha(s), situationSha(renamed), "the title and behaviour label are not the cast");
  for (const over of [{ persona: "another persona" }, { firstMessage: "Hello." }, { provokes: ["completed", "no_leak"] }, { handles: "Another response." }, { language: "cs" }, { fixture: "prep" as const }]) {
    assert.notEqual(situationSha({ ...s, ...over }), situationSha(s), JSON.stringify(over));
  }
});

test("case 7: resume re-runs a situation whose cast changed, and skips one whose cast and instrument both match", async () => {
  const s: SimSituation = testSituation({ id: "kit-resume-en" });
  const opts = {
    runId: "run-1",
    outDir: out,
    situations: [s],
    workers: 1,
    seed: 1,
    buildInstrument: async (f: SimFixture, l: string | null) => instrument(f, l),
    providers: (sit: SimSituation, inst: SimInstrument) => ({ interviewer: fakeInterviewer(inst.agenda), candidate: fakeCandidate(sit) }),
  };
  const first = await runSimulations(opts);
  assert.equal(first.ran.length, 1);
  const dumped = JSON.parse(readFileSync(path.join(out, `${s.id}.json`), "utf8")) as SimConversationDump;
  assert.equal(dumped.situationSha, situationSha(s), "the dump records the cast it ran");

  const same = await runSimulations({ ...opts, runId: "run-2" });
  assert.deepEqual(same.skipped, [s.id], "same cast, same instrument: skipped");

  const edited = { ...s, persona: `${s.persona} Now you interrupt often.` };
  const again = await runSimulations({ ...opts, runId: "run-3", situations: [edited] });
  assert.deepEqual(again.ran.map((r) => r.situationId), [s.id], "an edited persona is not the dumped conversation");
  assert.deepEqual(again.skipped, []);
  const redumped = JSON.parse(readFileSync(path.join(out, `${s.id}.json`), "utf8")) as SimConversationDump;
  assert.equal(redumped.situationSha, situationSha(edited));
});
