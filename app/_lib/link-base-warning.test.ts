import test from "node:test";
import assert from "node:assert/strict";
import { linkBaseProblem, linkBaseWarning, resetLinkBaseWarnForTests, warnLinkBaseOnce } from "./link-base-warning.ts";

test("loopback and placeholder bases are flagged, public ones are not", () => {
  assert.equal(linkBaseProblem("http://localhost:3000"), "loopback");
  assert.equal(linkBaseProblem("http://127.0.0.1:3101"), "loopback");
  assert.equal(linkBaseProblem("http://[::1]:3000"), "loopback");
  assert.equal(linkBaseProblem("http://app.localhost"), "loopback");
  assert.equal(linkBaseProblem("https://kandidate.example"), "placeholder");
  assert.equal(linkBaseProblem("https://jobs.acme.com"), null);
  assert.equal(linkBaseProblem("https://quiet-fox.trycloudflare.com"), null);
  assert.equal(linkBaseProblem(""), null);
});

test("the warning names both fixes and is null for a reachable base", () => {
  const line = linkBaseWarning("http://localhost:3000/");
  assert.ok(line?.includes("npm run up -- --public") && line.includes("APP_BASE_URL"));
  assert.equal(linkBaseWarning("https://jobs.acme.com"), null);
});

test("warnLinkBaseOnce logs once per process", () => {
  const saved = { a: process.env.APP_BASE_URL, n: process.env.NEXT_PUBLIC_APP_BASE_URL };
  delete process.env.APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_BASE_URL;
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => void calls.push(String(m));
  try {
    resetLinkBaseWarnForTests();
    assert.equal(warnLinkBaseOnce("http://localhost:3000"), "http://localhost:3000");
    warnLinkBaseOnce("http://localhost:3000");
    assert.equal(calls.filter((c) => c.startsWith("[link-base]")).length, 1);
    process.env.APP_BASE_URL = "https://jobs.acme.com";
    resetLinkBaseWarnForTests();
    calls.length = 0;
    warnLinkBaseOnce();
    assert.equal(calls.length, 0);
  } finally {
    console.warn = orig;
    if (saved.a === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved.a;
    if (saved.n === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_URL; else process.env.NEXT_PUBLIC_APP_BASE_URL = saved.n;
  }
});
