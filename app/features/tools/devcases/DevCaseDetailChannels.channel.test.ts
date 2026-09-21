import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPostingChannel, POSTING_CHANNELS } from "./DevCaseDetailChannels.channel.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

function catalog(locale: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
    devcase?: { studio?: { channel?: Record<string, string> } };
  };
  return raw.devcase?.studio?.channel ?? {};
}

test("every locale's studio.channel catalog covers exactly POSTING_CHANNELS", () => {
  const expected = [...POSTING_CHANNELS].sort();
  for (const locale of LOCALES) {
    const actual = Object.keys(catalog(locale)).sort();
    assert.deepEqual(actual, expected, `messages/${locale}.json devcase.studio.channel`);
    for (const label of Object.values(catalog(locale))) {
      assert.ok(label.trim().length > 0, `${locale} has an empty channel label`);
    }
  }
});

test("POSTING_CHANNELS covers the distribution producer and the publish default", () => {
  const dist = readFileSync(path.join(ROOT, "app", "_lib", "distribution.ts"), "utf8");
  const adapters = dist.match(/const ADAPTERS[^=]*= \{([^}]+)\}/);
  assert.ok(adapters, "could not locate ADAPTERS in distribution.ts");
  const produced = [...adapters![1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  const missing = produced.filter((id) => !isPostingChannel(id));
  assert.deepEqual(missing, [], `distribution ADAPTERS has uncatalogued channel(s): ${missing.join(", ")}`);

  const publish = readFileSync(path.join(ROOT, "app", "api", "devcase", "publish", "route.ts"), "utf8");
  const def = publish.match(/body\.channel \?\? "([a-z]+)"/);
  assert.ok(def, "could not locate the publish-route default channel");
  assert.equal(isPostingChannel(def![1]), true, `publish default "${def![1]}" is not a catalogued posting channel`);
});

test("an unknown channel id is not in the catalog, so the chip falls back to raw", () => {
  assert.equal(isPostingChannel("ats"), false);
  assert.equal(isPostingChannel("local"), true);
});
