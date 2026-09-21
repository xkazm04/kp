import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canSubmitDevApply, isHttpUrl } from "./devcase-apply-repo.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

test("isHttpUrl accepts http(s) and rejects everything else", () => {
  assert.equal(isHttpUrl("https://example.com/your-solution"), true);
  assert.equal(isHttpUrl("http://gitlab.example.org/a/b"), true);
  assert.equal(isHttpUrl("  https://codeberg.org/you/work  "), true);
  assert.equal(isHttpUrl("github.com/you/solution"), false);
  assert.equal(isHttpUrl("ftp://example.com/x"), false);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl(""), false);
});

test("canSubmitDevApply requires name, email-shaped contact, http(s) repo, and idle state", () => {
  const ok = { name: "Ada", contact: "ada@example.com", repoRef: "https://example.com/sol", busy: false };
  assert.equal(canSubmitDevApply(ok), true);
  assert.equal(canSubmitDevApply({ ...ok, repoRef: "github.com/you/solution" }), false);
  assert.equal(canSubmitDevApply({ ...ok, repoRef: "not-a-url" }), false);
  assert.equal(canSubmitDevApply({ ...ok, contact: "ada" }), false);
  assert.equal(canSubmitDevApply({ ...ok, name: "  " }), false);
  assert.equal(canSubmitDevApply({ ...ok, busy: true }), false);
});

test("the repo-link form placeholder is a catalog key, not a raw English GitHub URL", () => {
  const src = readFileSync(path.join(ROOT, "app", "devcase", "apply", "[token]", "DevApplyForm.tsx"), "utf8");
  assert.match(src, /placeholder=\{t\("fieldRepoPlaceholder"\)\}/);
  assert.doesNotMatch(src, /github\.com\/you\/solution/);
  assert.match(src, /canSubmitDevApply\(/);
});

test("fieldRepoPlaceholder and fieldRepoHint exist in all four catalogs", () => {
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
      devApply?: { fieldRepoPlaceholder?: string; fieldRepoHint?: string };
    };
    assert.ok(cat.devApply?.fieldRepoPlaceholder?.trim(), `messages/${locale}.json devApply.fieldRepoPlaceholder`);
    assert.ok(cat.devApply?.fieldRepoHint?.trim(), `messages/${locale}.json devApply.fieldRepoHint`);
  }
});
