import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accentIsLegible,
  contrastRatio,
  MAX_BRAND_NAME,
  MIN_ACCENT_CONTRAST,
  sanitizeAccentColor,
  sanitizeBrand,
  sanitizeBrandName,
  sanitizeLogoUrl,
} from "./brand-config.ts";

test("sanitizeAccentColor accepts hex only — the CSS-injection guard", () => {
  assert.equal(sanitizeAccentColor("#d65a4a"), "#d65a4a");
  assert.equal(sanitizeAccentColor("#ABC"), "#abc");
  assert.equal(sanitizeAccentColor("  #0057B8  "), "#0057b8");
  // Injection attempts + junk must all → null (they'd otherwise reach a <style>).
  for (const bad of [
    "red",
    "#12",
    "#gggggg",
    "rgb(0,0,0)",
    "#000; } body { display:none",
    "d65a4a",
    "",
    123,
    null,
    undefined,
    {},
  ]) {
    assert.equal(sanitizeAccentColor(bad as unknown), null, `${String(bad)} must be rejected`);
  }
});

test("sanitizeBrandName collapses whitespace, clamps, empty → null", () => {
  assert.equal(sanitizeBrandName("  Acme   Corp  "), "Acme Corp");
  assert.equal(sanitizeBrandName("   "), null);
  assert.equal(sanitizeBrandName("x".repeat(200))?.length, MAX_BRAND_NAME);
  assert.equal(sanitizeBrandName(42 as unknown), null);
});

test("sanitizeLogoUrl allows https only", () => {
  assert.equal(sanitizeLogoUrl("https://cdn.acme.com/logo.png"), "https://cdn.acme.com/logo.png");
  for (const bad of ["http://x/logo.png", "javascript:alert(1)", "data:image/png;base64,AAA", "ftp://x/l", "not a url", ""]) {
    assert.equal(sanitizeLogoUrl(bad), null, `${bad} must be rejected`);
  }
});

test("sanitizeBrand validates every field together", () => {
  assert.deepEqual(sanitizeBrand({ displayName: "  Acme  ", accentColor: "nope", logoUrl: "https://x/l.png" }), {
    displayName: "Acme",
    accentColor: null,
    logoUrl: "https://x/l.png",
  });
  assert.deepEqual(sanitizeBrand(null), { displayName: null, accentColor: null, logoUrl: null });
});

test("contrastRatio matches known WCAG values", () => {
  // Extremes and identity — the reference anchors of the WCAG formula.
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#000", "#fff"), 21); // 3-digit hex expands identically
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  // Symmetric regardless of argument order.
  assert.equal(contrastRatio("#d65a4a", "#ffffff"), contrastRatio("#ffffff", "#d65a4a"));
  // Invalid hex → NaN (never a false "passes").
  assert.ok(Number.isNaN(contrastRatio("red", "#ffffff")));
  assert.ok(Number.isNaN(contrastRatio("#12", "#ffffff")));
});

test("accentIsLegible: light accents fail, the default coral passes, absence is legible", () => {
  assert.equal(MIN_ACCENT_CONTRAST, 3);

  // The product's OWN default coral must pass — white text ~3.9:1, focus ring on
  // paper ~3.7:1, both ≥ 3. (Proves the threshold isn't set so high it rejects it.)
  assert.equal(accentIsLegible("#d65a4a"), true);
  assert.ok(contrastRatio("#d65a4a", "#ffffff") >= 3);
  assert.ok(contrastRatio("#d65a4a", "#fdf8ee") >= 3);
  assert.equal(accentIsLegible("#0057b8"), true); // strong blue — clearly fine

  // Light accents: white-on-accent AND focus-ring-on-paper both collapse < 3.
  assert.equal(accentIsLegible("#ffff88"), false); // pale yellow (~1.05:1 on white)
  assert.equal(accentIsLegible("#ffffff"), false); // white on white = 1:1
  assert.ok(contrastRatio("#ffff88", "#ffffff") < 3);

  // Very dark accent is fine (white text sails; ring stands out on cream paper).
  assert.equal(accentIsLegible("#000000"), true);

  // Absence = product default (legible); malformed hex is treated as illegible.
  assert.equal(accentIsLegible(null), true);
  assert.equal(accentIsLegible(""), true);
  assert.equal(accentIsLegible("nope"), false);
});

test("sanitizeBrand drops a hex-valid but ILLEGIBLE accent at the store boundary", () => {
  // Pre-fix this returned "#ffff88" (accepted → invisible white button text app-wide
  // and on candidate pages); the store now refuses to persist it.
  assert.equal(sanitizeBrand({ accentColor: "#ffff88" }).accentColor, null);
  assert.equal(sanitizeBrand({ accentColor: "#ffffff" }).accentColor, null);
  // A legible accent still round-trips unchanged.
  assert.equal(sanitizeBrand({ accentColor: "#d65a4a" }).accentColor, "#d65a4a");
  assert.equal(sanitizeBrand({ accentColor: "#0057B8" }).accentColor, "#0057b8");
});
