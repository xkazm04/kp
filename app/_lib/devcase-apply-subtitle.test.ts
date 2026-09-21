import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applySubtitleKey } from "./devcase-apply-subtitle.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

test("live-work (has seed) uses subtitleLive; repo-link uses subtitleRepo", () => {
  assert.equal(applySubtitleKey(true), "subtitleLive");
  assert.equal(applySubtitleKey(false), "subtitleRepo");
});

test("the apply page renders the helper's key, not a single subtitle", () => {
  const src = readFileSync(path.join(ROOT, "app", "devcase", "apply", "[token]", "page.tsx"), "utf8");
  assert.match(src, /applySubtitleKey\(seedFiles\.length > 0\)/);
  assert.doesNotMatch(src, /t\("subtitle"\)/);
});

test("subtitleLive and subtitleRepo exist in all four catalogs", () => {
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
      devApply?: { subtitleLive?: string; subtitleRepo?: string };
    };
    assert.ok(cat.devApply?.subtitleLive?.trim(), `messages/${locale}.json devApply.subtitleLive`);
    assert.ok(cat.devApply?.subtitleRepo?.trim(), `messages/${locale}.json devApply.subtitleRepo`);
  }
});
