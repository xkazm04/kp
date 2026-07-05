// unit-db must be the FIRST project import — it sets KP_DB_PATH to a throwaway file
// before brand-store (→ db-path) computes DB_PATH. See app/_lib/testing/unit-db.ts.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getBrand, saveBrand } from "./brand-store.ts";

after(() => cleanupUnitDb());

test("getBrand returns product defaults on a fresh DB", () => {
  assert.deepEqual(getBrand(), { displayName: null, accentColor: null, logoUrl: null });
});

test("saveBrand upserts + sanitizes; getBrand reads it back", () => {
  const saved = saveBrand({ displayName: "  Acme  Bank ", accentColor: "#0057B8", logoUrl: "https://cdn.acme/l.png" });
  assert.deepEqual(saved, { displayName: "Acme Bank", accentColor: "#0057b8", logoUrl: "https://cdn.acme/l.png" });
  assert.deepEqual(getBrand(), saved);

  // A second save overwrites the single workspace row (upsert, not insert).
  const updated = saveBrand({ displayName: "Acme", accentColor: "#123456", logoUrl: "" });
  assert.deepEqual(getBrand(), updated);
  assert.equal(updated.logoUrl, null);
});

test("saveBrand never persists a malicious accent / logo", () => {
  const cleaned = saveBrand({ displayName: "X", accentColor: "#000; } body { display:none", logoUrl: "javascript:alert(1)" });
  assert.equal(cleaned.accentColor, null);
  assert.equal(cleaned.logoUrl, null);
  assert.equal(getBrand().accentColor, null, "the injected-CSS accent must not be stored");
});
