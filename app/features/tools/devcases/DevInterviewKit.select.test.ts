import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pickKitSubmission, submissionsWithFollowups } from "./DevInterviewKit.select.ts";
import { interviewKitMarkdown, buildInterviewKitStrings } from "@/app/_lib/devcase-interview-kit.ts";
import { namespaceTranslator } from "@/app/_lib/catalog-translator.ts";
import type { Submission } from "./DevTypes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EN = buildInterviewKitStrings(await namespaceTranslator("en", "devcase.interviewKit"));

function sub(over: Partial<Submission> & { id: string; candidateRef: string }): Submission {
  return {
    repoRef: null,
    notes: null,
    receivedAt: "2026-01-01T00:00:00Z",
    transferScore: null,
    evaluation: { followups: { questions: [{ question: "Q" }] } },
    ...over,
  } as Submission;
}

const top = sub({ id: "top", candidateRef: "top@x.io", transferScore: 91 });
const held = sub({ id: "held", candidateRef: "held@x.io", transferScore: 44 });
const none = sub({
  id: "none",
  candidateRef: "none@x.io",
  transferScore: 80,
  evaluation: { followups: { questions: [] } },
});

test("every followup-bearing shortlist row is selectable; a row without questions is not", () => {
  const cands = submissionsWithFollowups([top, held, none]);
  assert.deepEqual(cands.map((s) => s.id), ["top", "held"]);
});

test("selecting a lower-transfer row changes the exported candidate line", () => {
  const cands = submissionsWithFollowups([top, held, none]);
  const picked = pickKitSubmission(cands, "held");
  assert.equal(picked?.id, "held");
  const md = interviewKitMarkdown(
    {
      caseTitle: "Payments",
      candidateRef: picked!.candidateRef ?? "—",
      transferScore: picked!.transferScore ?? null,
      questions: picked!.evaluation?.followups?.questions ?? [],
    },
    EN,
  );
  assert.match(md, /held@x\.io/);
  assert.doesNotMatch(md, /top@x\.io/);
});

test("an unknown or empty selection falls back to the transfer leader", () => {
  const cands = submissionsWithFollowups([top, held]);
  assert.equal(pickKitSubmission(cands, null)?.id, "top");
  assert.equal(pickKitSubmission(cands, "gone")?.id, "top");
  assert.equal(pickKitSubmission([], "top"), null);
});

test("kit band labels exist in all four catalogs", () => {
  const expected = ["authentic", "mixed", "suspect"];
  for (const locale of ["en", "cs", "de", "fr"]) {
    const kit = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).devcase.interviewKit;
    assert.ok(String(kit.pickAria ?? "").trim(), `${locale} pickAria`);
    assert.deepEqual(Object.keys(kit.band ?? {}).sort(), expected, locale);
  }
});
