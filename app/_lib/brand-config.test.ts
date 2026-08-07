import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accentIsLegible,
  contrastRatio,
  EXTERNAL_LOGO_IMG_ATTRS,
  isBrandFormDirty,
  MAX_BRAND_NAME,
  MIN_ACCENT_CONTRAST,
  normalizeHex6,
  sanitizeAccentColor,
  sanitizeBrand,
  sanitizeBrandName,
  sanitizeLogoUrl,
  shouldRenderLogo,
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

// ── Finding #5: 3-digit hex breaks the translucent-badge swatch ───────────────
test("normalizeHex6 expands 3-digit hex so the translucent-badge suffix stays valid", () => {
  assert.equal(normalizeHex6("#abc"), "#aabbcc");
  assert.equal(normalizeHex6("#ABC"), "#aabbcc");
  assert.equal(normalizeHex6("#d65a4a"), "#d65a4a");
  assert.equal(normalizeHex6("  #0057B8 "), "#0057b8");
  // The bug itself: pre-fix the preview did `${accent}1a` on the RAW accent, so a
  // 3-digit "#abc" became "#abc1a" — 5 hex digits, an invalid CSS color the browser
  // drops (badge loses its tint). Normalized first, it's a valid 8-digit #rrggbbaa.
  assert.equal(`${"#abc"}1a`, "#abc1a"); // pre-fix value (documented, invalid)
  assert.equal(`${normalizeHex6("#abc")}1a`, "#aabbcc1a"); // fixed value (valid)
  assert.equal(`${normalizeHex6("#abc")}1a`.length, 9);
  // Invalid hex → null, so the caller falls back to the product default.
  for (const bad of ["#12", "nope", "", "rgb(0,0,0)", "#gg"]) assert.equal(normalizeHex6(bad), null);
});

// ── Finding #3: external logo needs a graceful fallback + referrer mitigation ──
test("shouldRenderLogo: only a set, non-errored URL renders the external logo", () => {
  assert.equal(shouldRenderLogo("https://cdn.acme.com/l.png", false), true);
  // onError flips hasErrored → fall back to the bundled mark instead of a broken img.
  assert.equal(shouldRenderLogo("https://cdn.acme.com/l.png", true), false);
  assert.equal(shouldRenderLogo(null, false), false);
  assert.equal(shouldRenderLogo(undefined, false), false);
  assert.equal(shouldRenderLogo("", false), false);
  assert.equal(shouldRenderLogo("   ", false), false);
});

test("EXTERNAL_LOGO_IMG_ATTRS pins the referrer-leak mitigation without display-breaking CORS", () => {
  assert.equal(EXTERNAL_LOGO_IMG_ATTRS.referrerPolicy, "no-referrer");
  // Must NOT force a CORS fetch — that would break logos on hosts sending no CORS
  // headers. The decision to omit crossOrigin is deliberate; lock it here.
  assert.equal("crossOrigin" in EXTERNAL_LOGO_IMG_ATTRS, false);
});

// ── Finding #4: dirty tracking (Reset→baseline + unsaved-change guard) ─────────
test("isBrandFormDirty tracks divergence from the loaded/saved baseline", () => {
  const base = { name: "Acme", accent: "#d65a4a", logo: "https://x/l.png" };
  assert.equal(isBrandFormDirty(base, base), false);
  // Whitespace-only edits are not dirty (the store trims them anyway).
  assert.equal(isBrandFormDirty({ ...base, name: "  Acme  " }, base), false);
  // A real edit in ANY single field is dirty (enables Save + arms the guard).
  assert.equal(isBrandFormDirty({ ...base, name: "Beta" }, base), true);
  assert.equal(isBrandFormDirty({ ...base, accent: "#0057b8" }, base), true);
  assert.equal(isBrandFormDirty({ ...base, logo: "" }, base), true);
  // Fresh form vs. empty baseline: pristine is not dirty; typing a name is.
  const empty = { name: "", accent: "", logo: "" };
  assert.equal(isBrandFormDirty(empty, empty), false);
  assert.equal(isBrandFormDirty({ ...empty, name: "New" }, empty), true);
});
