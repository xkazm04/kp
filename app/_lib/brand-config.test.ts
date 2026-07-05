import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BRAND_NAME, sanitizeAccentColor, sanitizeBrand, sanitizeBrandName, sanitizeLogoUrl } from "./brand-config.ts";

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
