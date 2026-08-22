// unit-db must be the FIRST project import — it sets KP_DB_PATH to a throwaway file
// before brand-store (→ db-path) computes DB_PATH. See app/_lib/testing/unit-db.ts.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getBrand, saveBrand } from "./brand-store.ts";
import { openStore } from "./db-path.ts";

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

test("getBrand re-validates a row already AT REST, not just the write path", () => {
  // saveBrand first, so the lazily-created table exists and the row is present.
  saveBrand({ displayName: "Acme", accentColor: "#0057b8", logoUrl: "https://cdn.acme/l.png" });
  // Now simulate a row an EARLIER build wrote — straight to the table, bypassing
  // sanitizeBrand: an accent that predates the WCAG legibility gate (#ffff88 →
  // invisible white button labels + focus rings, app-wide and on candidate pages),
  // a logo on a scheme the https rule now refuses, and an unclamped display name.
  openStore()
    .prepare(`UPDATE brand_settings SET display_name = ?, accent_color = ?, logo_url = ? WHERE id = 'workspace'`)
    .run("  Legacy   Corp  ".padEnd(300, "x"), "#ffff88", "http://cdn.acme/l.png");

  const effective = getBrand();
  // Pre-fix getBrand returned the row verbatim, so BrandStyle.tsx injected
  // `--color-coral:#ffff88` on every request forever.
  assert.equal(effective.accentColor, null, "an illegible stored accent must not be served");
  assert.equal(effective.logoUrl, null, "a non-https stored logo must not reach an <img src>");
  assert.ok((effective.displayName ?? "").length <= 60, "a stored name is clamped on read too");

  // Idempotent for anything saveBrand itself wrote — a clean round-trip is unchanged.
  const clean = saveBrand({ displayName: "Acme Bank", accentColor: "#0057B8", logoUrl: "https://cdn.acme/l.png" });
  assert.deepEqual(getBrand(), clean);
});
