import { test } from "node:test";
import assert from "node:assert/strict";
import { cvAutofill, extractCvEmail, guessCvName } from "./cv-autofill.ts";

test("extractCvEmail finds and lowercases the first email", () => {
  assert.equal(extractCvEmail("Jane Doe\nJane.Doe@Example.COM\nPrague"), "jane.doe@example.com");
  assert.equal(extractCvEmail("no address here"), undefined);
  assert.equal(extractCvEmail("reach me: a+tag@sub.domain.co.uk later"), "a+tag@sub.domain.co.uk");
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
