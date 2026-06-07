// Unit tests pinning renderTemplate's separator-collapse contract — see the
// "Separator-collapse contract" block in render-template.ts. These lock the
// intended behavior so it survives template evolution and refactors.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  DEFAULT_TEMPLATE_BODY,
  TEMPLATE_SEPARATOR,
  findUnknownPlaceholders,
  unknownPlaceholderMessage,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_BODY_MAX_LENGTH,
  validateTemplateFields,
  validateTemplateUpdate,
} from "./render-template.ts";

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

// ---- findUnknownPlaceholders — the save-time linter -------------------------
// Pins the unknown-token policy (BLOCKED): every {{token}} renderTemplate would
// leave verbatim must be reported so the API/manager can reject it pre-save.

test("linter: the default template body has no unknown placeholders", () => {
  assert.deepEqual(findUnknownPlaceholders(DEFAULT_TEMPLATE_BODY), []);
});

test("linter: a body using only the known set passes", () => {
  const body = "# {{title}} at {{company}}\n{{about}}\n{{responsibilities}}";
  assert.deepEqual(findUnknownPlaceholders(body), []);
});

test("linter: a typo'd token is reported", () => {
  // {{tilte}} — exactly the silent-defect case from the requirement.
  assert.deepEqual(findUnknownPlaceholders("# {{tilte}}\n{{company}}"), ["tilte"]);
});

test("linter: out-of-set tokens are reported", () => {
  assert.deepEqual(
    findUnknownPlaceholders("{{title}} in {{location}} — {{roleFamily}}"),
    ["location", "roleFamily"],
  );
});

test("linter: unknown tokens are de-duped, in first-seen order", () => {
  assert.deepEqual(
    findUnknownPlaceholders("{{location}} {{title}} {{roleFamily}} {{location}}"),
    ["location", "roleFamily"],
  );
});

test("linter: what the linter flags is exactly what renderTemplate leaves raw", () => {
  // The linter and renderer must agree: any token the linter passes is one
  // renderTemplate substitutes, and any token it flags renders verbatim.
  const body = "{{title}} — {{location}}";
  assert.deepEqual(findUnknownPlaceholders(body), ["location"]);
  assert.equal(renderTemplate(body, { title: "Engineer" }), "Engineer — {{location}}");
});

test("linter: malformed brace text that renderTemplate ignores is not flagged", () => {
  // renderTemplate only substitutes {{\w+}}, so "{{ title }}" (spaces) and "{{}}"
  // are inert literal text — the linter scopes itself to the same token shape.
  assert.deepEqual(findUnknownPlaceholders("{{ title }} and {{}}"), []);
});

test("linter message: singular vs plural and the supported list", () => {
  const one = unknownPlaceholderMessage(["tilte"]);
  assert.match(one, /^Unknown placeholder: \{\{tilte\}\}\./);
  assert.match(one, /\{\{title\}\}/); // names the supported set

  const many = unknownPlaceholderMessage(["location", "roleFamily"]);
  assert.match(many, /^Unknown placeholders: \{\{location\}\}, \{\{roleFamily\}\}\./);
});

// ---- validateTemplateFields — the create write boundary --------------------
// Templates are a fan-out point (re-fetched on every builder/manager open,
// rendered into every JD built from them). The old POST guard was a bare
// truthiness check (`!body.name || !body.body`) with NO length cap and a single
// space slipping through to be coerced to "Untitled template". These pin the
// trim + caps so a refactor can't silently re-open the unbounded-input hole.

test("create: accepts a real name + body, returning trimmed fields", () => {
  const r = validateTemplateFields("  Engineering  ", "  # {{title}}  ");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.name, "Engineering");
    assert.equal(r.body, "# {{title}}");
  }
});

test("create: rejects a missing or whitespace-only name (no silent 'Untitled' coercion)", () => {
  // The exact defect: a single space passed the old truthiness check, then the
  // store coerced it to "Untitled template". It must now be rejected up front.
  assert.equal(validateTemplateFields("   ", "body").ok, false);
  assert.equal(validateTemplateFields("", "body").ok, false);
  assert.equal(validateTemplateFields(undefined, "body").ok, false);
});

test("create: rejects a missing or whitespace-only body", () => {
  assert.equal(validateTemplateFields("Name", "   ").ok, false);
  assert.equal(validateTemplateFields("Name", "").ok, false);
  assert.equal(validateTemplateFields("Name", undefined).ok, false);
});

test("create: caps name and body at the limits the team trusts", () => {
  assert.equal(validateTemplateFields("a".repeat(TEMPLATE_NAME_MAX_LENGTH), "body").ok, true);
  assert.equal(validateTemplateFields("a".repeat(TEMPLATE_NAME_MAX_LENGTH + 1), "body").ok, false);
  assert.equal(validateTemplateFields("Name", "b".repeat(TEMPLATE_BODY_MAX_LENGTH)).ok, true);
  assert.equal(validateTemplateFields("Name", "b".repeat(TEMPLATE_BODY_MAX_LENGTH + 1)).ok, false);
});

test("create: each failure carries a distinct, user-facing message", () => {
  const required = validateTemplateFields("", "");
  const longName = validateTemplateFields("a".repeat(TEMPLATE_NAME_MAX_LENGTH + 1), "body");
  const longBody = validateTemplateFields("Name", "b".repeat(TEMPLATE_BODY_MAX_LENGTH + 1));
  assert.equal(required.ok, false);
  assert.equal(longName.ok, false);
  assert.equal(longBody.ok, false);
  if (!required.ok && !longName.ok && !longBody.ok) {
    assert.match(required.error, /required/i);
    assert.match(longName.error, /name/i);
    assert.match(longBody.error, /body/i);
    assert.notEqual(longName.error, longBody.error);
  }
});

// ---- validateTemplateUpdate — the partial edit write boundary --------------
// PUT carries name and/or body (rename-only, body-only, or both). Only the
// present fields are validated, but a present field is still trimmed, capped,
// and may not be whitespace-only — so a partial edit can't store an empty
// name/body (the old `input.body ?? cur.body` would accept "") or exceed caps.

test("update: a present name and body are trimmed and returned", () => {
  const r = validateTemplateUpdate({ name: "  Renamed  ", body: "  new body  " });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.name, "Renamed");
    assert.equal(r.body, "new body");
  }
});

test("update: rename-only omits body; body-only omits name", () => {
  const rename = validateTemplateUpdate({ name: "Renamed" });
  assert.equal(rename.ok, true);
  if (rename.ok) {
    assert.equal(rename.name, "Renamed");
    assert.equal(rename.body, undefined); // not touched
  }
  const rebody = validateTemplateUpdate({ body: "just the body" });
  assert.equal(rebody.ok, true);
  if (rebody.ok) {
    assert.equal(rebody.name, undefined);
    assert.equal(rebody.body, "just the body");
  }
});

test("update: a promote-to-default (no name/body) passes through with no fields", () => {
  const r = validateTemplateUpdate({});
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.name, undefined);
    assert.equal(r.body, undefined);
  }
});

test("update: a present-but-empty name or body is rejected, not silently kept", () => {
  assert.equal(validateTemplateUpdate({ name: "   " }).ok, false);
  assert.equal(validateTemplateUpdate({ body: "" }).ok, false);
  assert.equal(validateTemplateUpdate({ name: "ok", body: "   " }).ok, false);
});

test("update: present fields are capped to the same limits as create", () => {
  assert.equal(validateTemplateUpdate({ name: "a".repeat(TEMPLATE_NAME_MAX_LENGTH + 1) }).ok, false);
  assert.equal(validateTemplateUpdate({ body: "b".repeat(TEMPLATE_BODY_MAX_LENGTH + 1) }).ok, false);
  assert.equal(validateTemplateUpdate({ name: "a".repeat(TEMPLATE_NAME_MAX_LENGTH) }).ok, true);
});
