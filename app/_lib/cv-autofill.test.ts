import { test } from "node:test";
import assert from "node:assert/strict";
import { cvAutofill, extractCvEmail, guessCvName } from "./cv-autofill.ts";

test("extractCvEmail finds and lowercases the sole email", () => {
  assert.equal(extractCvEmail("Jane Doe\nJane.Doe@Example.COM\nPrague"), "jane.doe@example.com");
  assert.equal(extractCvEmail("no address here"), undefined);
  assert.equal(extractCvEmail("reach me: a+tag@sub.domain.co.uk later"), "a+tag@sub.domain.co.uk");
  // The SAME address repeated (header + footer) is still one person → still returned.
  assert.equal(extractCvEmail("Jane Doe\njane@x.com\n...\nContact again: jane@x.com"), "jane@x.com");
});

// FINDING #5 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities): a CV that lists a
// referee's / employer's / host's address BEFORE the candidate's own must not prefill
// that first address. Attribute to the candidate via their name's contact block.
test("extractCvEmail attributes to the candidate's contact block, not the first email", () => {
  // Referee address above the name — pre-fix returned john@bigco.com (first match); the
  // fix returns the address in the candidate's name block instead.
  assert.equal(
    extractCvEmail("References: john@bigco.com\nJane Applicant\njane.applicant@gmail.com\nPrague"),
    "jane.applicant@gmail.com",
  );
  // Former-employer address above the name; candidate email on its own line below.
  assert.equal(
    extractCvEmail("Former role: Acme Corp (hr@acme.com)\nJan Novak\njan.novak@gmail.com\nBrno"),
    "jan.novak@gmail.com",
  );
});

test("extractCvEmail prefills NOTHING when multiple addresses can't be attributed", () => {
  // Two distinct addresses and no detectable name → ambiguous, so no confident default.
  assert.equal(extractCvEmail("host@portfolio.com\nreferences: john@bigco.com"), undefined);
  // A name, but its contact block holds two addresses → still ambiguous → skip.
  assert.equal(extractCvEmail("Jane Applicant\njane@gmail.com  alt@work.com"), undefined);
});

test("guessCvName reads a plausible name from the top, skipping headers", () => {
  assert.equal(guessCvName("Jane Doe\nSoftware Engineer\njane@x.com"), "Jane Doe");
  assert.equal(guessCvName("Curriculum Vitae\nJan Novák\nPraha"), "Jan Novák"); // skips the CV header
  assert.equal(guessCvName("Mary-Jane O'Brien\nDeveloper"), "Mary-Jane O'Brien");
});

test("guessCvName returns undefined when nothing at the top looks like a name", () => {
  assert.equal(guessCvName("Senior Backend Developer with 8 years experience building..."), undefined);
  assert.equal(guessCvName("john@x.com\n+420 123 456 789"), undefined); // email + phone, no name line
  assert.equal(guessCvName("A really long heading line that is clearly not a personal name at all"), undefined);
  assert.equal(guessCvName("Engineer2024"), undefined); // single token w/ digits
});

test("cvAutofill returns only the fields that parsed", () => {
  assert.deepEqual(cvAutofill("Jane Doe\njane@x.com"), { name: "Jane Doe", email: "jane@x.com" });
  assert.deepEqual(cvAutofill("Senior Engineer\nbuilt systems"), {});
  assert.deepEqual(cvAutofill("Jane Doe\nno email"), { name: "Jane Doe" });
});
