import { test } from "node:test";
import assert from "node:assert/strict";
import { chainLinkHref } from "./chainLinkHref.ts";

const paramsOf = (href: string) => new URL(href, "http://localhost").searchParams;

test("a link with no params clears every tab-scoped param (same as a bare tab switch)", () => {
  const p = paramsOf(chainLinkHref({ tab: "pipeline" }, "tab=matrix&job=j1&role=x"));
  assert.equal(p.get("tab"), "pipeline");
  assert.equal(p.get("job"), null);
  assert.equal(p.get("role"), null);
});

test("link params survive the tab-scoped clearing", () => {
  const p = paramsOf(chainLinkHref({ tab: "pipeline", params: { role: "j1" } }, "tab=matrix&job=j1&stage=Interview"));
  assert.equal(p.get("tab"), "pipeline");
  assert.equal(p.get("role"), "j1");
  assert.equal(p.get("job"), null, "unrelated scoped params are still cleared");
  assert.equal(p.get("stage"), null);
});

test("job param reaches decisions", () => {
  assert.equal(paramsOf(chainLinkHref({ tab: "decisions", params: { job: "j9" } }, "")).get("job"), "j9");
});
