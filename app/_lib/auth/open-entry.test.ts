// cx T2: the landing's in-app entry (open mode, local) and the return-visit skip.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isOpenMode,
  isLoopbackHost,
  openEntryOffered,
  returnVisitDecision,
  readEntryMarker,
  writeEntryMarker,
  clearEntryMarker,
  claimAutoEntry,
} from "./open-entry.ts";
import { enterWorkspace, leaveWorkspace } from "./session-nav.ts";

const g = globalThis as { window?: unknown; fetch?: unknown };
afterEach(() => {
  delete g.window;
  delete g.fetch;
});

const memStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

test("open mode gets the in-app entry on a loopback host; password mode keeps Sign in", () => {
  assert.equal(isOpenMode({}), true);
  assert.equal(isOpenMode({ KP_OPERATOR_PASSWORD: "x" }), false);
  assert.equal(openEntryOffered({ openMode: true, host: "localhost:3000" }), true);
  assert.equal(openEntryOffered({ openMode: false, host: "localhost:3000" }), false);
});

test("a public host never gets the in-app entry, even in open mode", () => {
  assert.equal(openEntryOffered({ openMode: true, host: "kp.example.com" }), false);
  assert.equal(openEntryOffered({ openMode: true, host: null }), false);
  assert.equal(isLoopbackHost("127.0.0.1:3000"), true);
  assert.equal(isLoopbackHost("[::1]:3000"), true);
  assert.equal(isLoopbackHost("localhost.evil.com"), false);
});

test("return visit: only marker + open entry skips the landing", () => {
  assert.equal(returnVisitDecision({ openEntry: true, marker: true }), "enter");
  assert.equal(returnVisitDecision({ openEntry: true, marker: false }), "stay");
  assert.equal(returnVisitDecision({ openEntry: false, marker: true }), "stay", "password mode / public link ignore the marker");
  assert.equal(returnVisitDecision({ openEntry: false, marker: false }), "stay");
});

test("marker helpers round-trip and survive blocked storage", () => {
  g.window = { localStorage: memStore(), sessionStorage: memStore() };
  assert.equal(readEntryMarker(), false);
  writeEntryMarker();
  assert.equal(readEntryMarker(), true);
  assert.equal(claimAutoEntry(), true);
  assert.equal(claimAutoEntry(), false, "one auto-entry per tab: no reload loop");
  clearEntryMarker();
  assert.equal(readEntryMarker(), false);
  assert.equal(claimAutoEntry(), true, "sign-out resets the guard too");

  const blocked = {
    get localStorage(): never {
      throw new Error("blocked");
    },
    get sessionStorage(): never {
      throw new Error("blocked");
    },
  };
  g.window = blocked;
  assert.equal(readEntryMarker(), false);
  assert.doesNotThrow(() => writeEntryMarker());
  assert.doesNotThrow(() => clearEntryMarker());
  assert.equal(claimAutoEntry(), false);
});

test("enterWorkspace writes the marker only for the open-mode answer", async () => {
  const local = memStore();
  g.window = { localStorage: local, sessionStorage: memStore(), location: { assign: () => {} } };
  g.fetch = async () => ({ ok: true, json: async () => ({ ok: true, open: true }) }) as Response;
  await enterWorkspace();
  assert.equal(readEntryMarker(), true);

  clearEntryMarker();
  g.fetch = async () => ({ ok: false, json: async () => ({}) }) as Response;
  await enterWorkspace();
  assert.equal(readEntryMarker(), false, "password mode (401) leaves no marker");

  g.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) }) as Response;
  await enterWorkspace();
  assert.equal(readEntryMarker(), false, "a non-open success leaves no marker");
});

test("leaveWorkspace clears the marker so sign-out sticks", async () => {
  g.window = { localStorage: memStore(), sessionStorage: memStore(), location: { assign: () => {} } };
  g.fetch = async () => ({ ok: true }) as Response;
  writeEntryMarker();
  await leaveWorkspace();
  assert.equal(readEntryMarker(), false);
});

test("the landing CTAs pick the open label from the context, and the keys exist in every locale", () => {
  const ctas = readFileSync(new URL("../../landing/site/chrome/Ctas.tsx", import.meta.url), "utf8");
  assert.match(ctas, /openEntry \? "hero\.ctaOpen" : "hero\.ctaPrimary"/);
  assert.match(ctas, /openEntry \? "nav\.openWorkspace" : "nav\.signIn"/);
  for (const l of ["en", "cs", "de", "fr"]) {
    const m = JSON.parse(readFileSync(new URL(`../../../messages/${l}.json`, import.meta.url), "utf8"));
    assert.ok(m.landing.hero.ctaOpen, `${l} hero.ctaOpen`);
    assert.ok(m.landing.nav.openWorkspace, `${l} nav.openWorkspace`);
  }
});
