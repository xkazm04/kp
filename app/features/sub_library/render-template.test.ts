// Unit tests pinning renderTemplate's separator-collapse contract — see the
// "Separator-collapse contract" block in render-template.ts. These lock the
// intended behavior so it survives template evolution and refactors.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, DEFAULT_TEMPLATE_BODY, TEMPLATE_SEPARATOR } from "./render-template.ts";

const SEP = TEMPLATE_SEPARATOR; // " · "
// The default template's header line in isolation, so each case asserts the
// collapse behavior without the surrounding document.
const HEADER = `**{{company}}**${SEP}{{seniority}}${SEP}{{salary}}`;

test("header: all three fields present render verbatim with separators", () => {
  assert.equal(
    renderTemplate(HEADER, { company: "Acme", seniority: "Senior", salary: "120k" }),
    `**Acme**${SEP}Senior${SEP}120k`,
  );
});

test("header: empty seniority collapses its orphaned separator", () => {
  assert.equal(
    renderTemplate(HEADER, { company: "Acme", salary: "120k" }),
    `**Acme**${SEP}120k`,
  );
});

test("header: empty salary collapses the trailing separator", () => {
  assert.equal(
    renderTemplate(HEADER, { company: "Acme", seniority: "Senior" }),
    `**Acme**${SEP}Senior`,
  );
});

test("header: both empty leaves just the company, no dangling separators", () => {
  assert.equal(renderTemplate(HEADER, { company: "Acme" }), "**Acme**");
});

test("whitespace-only fields are treated as empty and collapse", () => {
  assert.equal(
    renderTemplate(HEADER, { company: "Acme", seniority: "   ", salary: "\t" }),
    "**Acme**",
  );
});

test("a literal separator in static template text is preserved", () => {
  // The middots here are real content, NOT adjacent to any empty placeholder, so
  // they must survive — the previous output-scanning regex could mangle this.
  const body = `Perks: gym${SEP}lunch${SEP}transit\n**{{company}}**${SEP}{{seniority}}`;
  assert.equal(
    renderTemplate(body, { company: "Acme" }), // seniority empty
    `Perks: gym${SEP}lunch${SEP}transit\n**Acme**`,
  );
});

test("a trailing literal separator is preserved (no false collapse)", () => {
  // No placeholders → nothing renders empty → the line is returned untouched,
  // even though it ends with a separator. The old `/ · $/gm` regex stripped it.
  assert.equal(renderTemplate(`Mon${SEP}Tue${SEP}`, {}), `Mon${SEP}Tue${SEP}`);
});

test("collapses around an empty placeholder regardless of ordering", () => {
  // A custom layout that puts the empty field first still collapses cleanly.
  assert.equal(renderTemplate(`{{seniority}}${SEP}{{company}}`, { company: "Acme" }), "Acme");
});

test("unknown placeholders are left verbatim", () => {
  assert.equal(renderTemplate("{{company}} — {{unknown}}", { company: "Acme" }), "Acme — {{unknown}}");
});

test("default template: header collapses and lists fall back to a dash", () => {
  const out = renderTemplate(DEFAULT_TEMPLATE_BODY, { title: "Engineer", company: "Acme" });
  assert.match(out, /^# Engineer$/m);
  assert.match(out, /^\*\*Acme\*\*$/m); // no seniority/salary → header is just the company
  assert.match(out, /^- —$/m); // empty responsibilities/mustHaves/niceToHaves fall back
  assert.ok(!out.includes(`${SEP}\n`), "no separator should be left dangling before a newline");
});
