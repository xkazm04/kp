// Pins the attachment half of the Analyze draft layer (challenge-r02
// analyze-engine/B): the CV variants, JD file and company file survive a tab
// switch in MODULE MEMORY — never in browser storage, because CV bytes are
// candidate PII — and reset wipes them.
//
// Runner: Node's built-in test runner (File is a global in Node 20+).
//   npm run test:unit
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as store from "./analyzeAttachmentStore.ts";

const file = (name: string, body = name) => new File([body], name, { type: "application/pdf" });

// The store refuses to hold anything outside a browser (a server module is shared
// across requests); give this process a window so the browser path is exercised.
const g = globalThis as { window?: unknown };
g.window ??= globalThis;

afterEach(() => store.clearAnalyzeAttachments());

test("put then take returns the same File objects, in order", () => {
  const a = file("a.pdf");
  const b = file("b.pdf");
  const j = file("jd.pdf");
  store.putAnalyzeAttachments({ cvFiles: [a, b], jobDescriptionFile: j, companyFile: null });
  const got = store.takeAnalyzeAttachments();
  assert.equal(got.cvFiles.length, 2);
  assert.equal(got.cvFiles[0], a, "identity, not a copy: the hash dedupe keys on the same bytes");
  assert.equal(got.cvFiles[1], b);
  assert.equal(got.jobDescriptionFile, j);
  assert.equal(got.companyFile, null);
  // A read does not drain: React may run an initializer twice (StrictMode), and the
  // second mount must see the same files as the first.
  assert.equal(store.takeAnalyzeAttachments().cvFiles[1], b);
});

test("after clear, take is empty (reset wipes the held files)", () => {
  store.putAnalyzeAttachments({ cvFiles: [file("a.pdf")], jobDescriptionFile: file("jd.pdf"), companyFile: file("c.pdf") });
  store.clearAnalyzeAttachments();
  assert.deepEqual(store.takeAnalyzeAttachments(), { cvFiles: [], jobDescriptionFile: null, companyFile: null });
  assert.deepEqual(store.takeAnalyzeAttachments(), { cvFiles: [], jobDescriptionFile: null, companyFile: null });
});

test("the snapshot is detached: mutating what take returned does not reach the store", () => {
  store.putAnalyzeAttachments({ cvFiles: [file("a.pdf")], jobDescriptionFile: null, companyFile: null });
  const got = store.takeAnalyzeAttachments();
  (got.cvFiles as File[]).push(file("intruder.pdf"));
  assert.equal(store.takeAnalyzeAttachments().cvFiles.length, 1);
});

test("module memory only: no serializer, and nothing reaches sessionStorage or localStorage", () => {
  const writes: string[] = [];
  const spy = {
    getItem: () => null,
    setItem: (k: string) => writes.push(k),
    removeItem: (k: string) => writes.push(`-${k}`),
    clear: () => writes.push("clear"),
    key: () => null,
    length: 0,
  };
  const gs = globalThis as { sessionStorage?: unknown; localStorage?: unknown };
  const prevS = gs.sessionStorage;
  const prevL = gs.localStorage;
  gs.sessionStorage = spy;
  gs.localStorage = spy;
  try {
    store.putAnalyzeAttachments({ cvFiles: [file("a.pdf")], jobDescriptionFile: file("jd.pdf"), companyFile: null });
    store.takeAnalyzeAttachments();
    store.clearAnalyzeAttachments();
  } finally {
    gs.sessionStorage = prevS;
    gs.localStorage = prevL;
  }
  assert.deepEqual(writes, [], "the store must never touch browser storage");
  const exported = Object.keys(store).sort();
  assert.deepEqual(exported, ["clearAnalyzeAttachments", "putAnalyzeAttachments", "takeAnalyzeAttachments"]);
  // And the source cannot grow one quietly: no storage API, no JSON encoding.
  const src = readFileSync(fileURLToPath(new URL("./analyzeAttachmentStore.ts", import.meta.url)), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /sessionStorage|localStorage|indexedDB|JSON\.stringify|toJSON/);
});

test("outside a browser the store holds nothing (a server module would leak across requests)", () => {
  const prev = g.window;
  delete g.window;
  try {
    store.putAnalyzeAttachments({ cvFiles: [file("a.pdf")], jobDescriptionFile: null, companyFile: null });
    assert.deepEqual(store.takeAnalyzeAttachments().cvFiles, []);
  } finally {
    g.window = prev;
  }
});
