import test from "node:test";
import assert from "node:assert/strict";
import { candidateLinkBase, resetCandidateLinkBaseWarnForTests } from "./comms-dispatch.ts";
import { resetLinkBaseWarnForTests } from "./link-base-warning.ts";

async function withBase(base: string | undefined, run: (warnings: string[]) => Promise<void>) {
  const saved = { a: process.env.APP_BASE_URL, n: process.env.NEXT_PUBLIC_APP_BASE_URL };
  delete process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (base === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = base;
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (m: unknown) => void warnings.push(String(m));
  resetLinkBaseWarnForTests();
  resetCandidateLinkBaseWarnForTests();
  try {
    await run(warnings);
  } finally {
    console.warn = orig;
    if (saved.a === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved.a;
    if (saved.n === undefined) delete process.env.NEXT_PUBLIC_APP_BASE_URL; else process.env.NEXT_PUBLIC_APP_BASE_URL = saved.n;
  }
}

test("a localhost link base warns once across two sends", async () => {
  await withBase("http://localhost:3000", async (warnings) => {
    assert.equal(await candidateLinkBase(), "http://localhost:3000");
    await candidateLinkBase();
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].startsWith("[link-base]"));
  });
});

test("an unconfigured (fallback) base warns once across two sends", async () => {
  await withBase(undefined, async (warnings) => {
    await candidateLinkBase();
    await candidateLinkBase();
    assert.equal(warnings.length, 1);
  });
});

test("a public base logs nothing", async () => {
  await withBase("https://jobs.acme.com", async (warnings) => {
    assert.equal(await candidateLinkBase(), "https://jobs.acme.com");
    await candidateLinkBase();
    assert.deepEqual(warnings, []);
  });
});
