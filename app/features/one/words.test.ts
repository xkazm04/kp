// A view is named by its TITLE everywhere (tabs, the change line, pins): the rule that
// turns kind + params into the title the panel puts in its own head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { viewTitle } from "./words.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const core = JSON.parse(readFileSync(path.join(ROOT, "messages", "en.json"), "utf8")).one.core;
const t = (key: string, values: Record<string, string> = {}) => {
  const raw = key.split(".").reduce((o: Record<string, unknown>, k) => o[k] as Record<string, unknown>, core) as unknown as string;
  assert.equal(typeof raw, "string", key);
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
};

test("a filtered pipeline is named by its filter, a role rides after the title", () => {
  assert.equal(viewTitle("pipelineSlice", { filter: "aging" }, t), "Stalled candidates");
  assert.equal(viewTitle("pipelineSlice", { filter: "new" }, t), "New arrivals");
  assert.equal(viewTitle("pipelineSlice", {}, t), "Pipeline");
  assert.equal(viewTitle("pipelineSlice", { role: "backend" }, t), "Pipeline · backend");
  assert.equal(viewTitle("decisionsQueue", {}, t), "Decisions waiting");
});
