import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewKitMarkdown } from "./devcase-interview-kit.ts";

test("renders a numbered kit with header, fit, and internal notes", () => {
  const md = interviewKitMarkdown({
    caseTitle: "Payments service",
    candidateRef: "alex@example.com",
    transferScore: 82,
    questions: [
      { question: "Why did you keep the legacy adapter?", decision: "read-before-break", listenFor: "names the seam", redFlag: "vague 'it worked'" },
      { question: "Walk me through the retry choice.", listenFor: "idempotency" },
    ],
  });
  assert.match(md, /# Interview kit — Payments service/);
  assert.match(md, /transfer fit 82/);
  assert.match(md, /## 1\. Why did you keep the legacy adapter\?/);
  assert.match(md, /Decision under test: read-before-break/);
  assert.match(md, /Red flag: vague 'it worked'/);
  assert.match(md, /## 2\. Walk me through the retry choice\./);
});

test("drops questions with no text and renumbers", () => {
  const md = interviewKitMarkdown({
    caseTitle: "C",
    candidateRef: "c",
    transferScore: null,
    questions: [{ question: "  " }, { question: "Real one" }],
  });
  assert.doesNotMatch(md, /## 2\./); // only one usable → no second heading
  assert.match(md, /## 1\. Real one/);
});

test("no usable questions yields a guidance line, not an empty kit", () => {
  const md = interviewKitMarkdown({ caseTitle: "C", candidateRef: "c", transferScore: 50, questions: [] });
  assert.match(md, /No follow-up questions were minted/);
});

test("omits the fit suffix when transferScore is null", () => {
  const md = interviewKitMarkdown({ caseTitle: "C", candidateRef: "c", transferScore: null, questions: [{ question: "Q" }] });
  assert.doesNotMatch(md, /transfer fit/);
});
