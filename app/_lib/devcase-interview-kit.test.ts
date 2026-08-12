import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInterviewKitStrings, interviewKitMarkdown } from "./devcase-interview-kit.ts";
import { namespaceTranslator } from "./catalog-translator.ts";

// F15 — the kit takes its copy as a parameter, so the tests feed it the REAL
// catalog (the same call the panel makes). A missing `devcase.interviewKit.doc.*`
// key fails here rather than printing a key path into a document a panel reads.
const EN = buildInterviewKitStrings(await namespaceTranslator("en", "devcase.interviewKit"));
const CS = buildInterviewKitStrings(await namespaceTranslator("cs", "devcase.interviewKit"));

test("renders a numbered kit with header, fit, and internal notes", () => {
  const md = interviewKitMarkdown(
    {
      caseTitle: "Payments service",
      candidateRef: "alex@example.com",
      transferScore: 82,
      questions: [
        { question: "Why did you keep the legacy adapter?", decision: "read-before-break", listenFor: "names the seam", redFlag: "vague 'it worked'" },
        { question: "Walk me through the retry choice.", listenFor: "idempotency" },
      ],
    },
    EN
  );
  assert.match(md, /# Interview kit: Payments service/);
  assert.match(md, /transfer fit 82/);
  assert.match(md, /## 1\. Why did you keep the legacy adapter\?/);
  assert.match(md, /Decision under test: read-before-break/);
  assert.match(md, /Red flag: vague 'it worked'/);
  assert.match(md, /## 2\. Walk me through the retry choice\./);
});

test("drops questions with no text and renumbers", () => {
  const md = interviewKitMarkdown(
    {
      caseTitle: "C",
      candidateRef: "c",
      transferScore: null,
      questions: [{ question: "  " }, { question: "Real one" }],
    },
    EN
  );
  assert.doesNotMatch(md, /## 2\./); // only one usable → no second heading
  assert.match(md, /## 1\. Real one/);
});

test("no usable questions yields a guidance line, not an empty kit", () => {
  const md = interviewKitMarkdown({ caseTitle: "C", candidateRef: "c", transferScore: 50, questions: [] }, EN);
  assert.match(md, /No follow-up questions were minted/);
});

test("omits the fit suffix when transferScore is null", () => {
  const md = interviewKitMarkdown({ caseTitle: "C", candidateRef: "c", transferScore: null, questions: [{ question: "Q" }] }, EN);
  assert.doesNotMatch(md, /transfer fit/);
});

test("F15 — the scaffolding localizes but the minted question text stays verbatim", () => {
  // The internal-notes warning is an INSTRUCTION to the interviewer ("never read
  // them aloud"), so it has to reach them in their language. The question itself is
  // model-minted free text about one submission and is left exactly as minted.
  const md = interviewKitMarkdown(
    { caseTitle: "Platby", candidateRef: "a@b.cz", transferScore: 70, questions: [{ question: "Why the adapter?", redFlag: "vague" }] },
    CS
  );
  assert.match(md, /Why the adapter\?/);
  assert.doesNotMatch(md, /Red flag:/);
  assert.doesNotMatch(md, /# Interview kit/);
});
