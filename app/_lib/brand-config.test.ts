import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCENT_GROUNDS,
  accentIsLegible,
  contrastRatio,
  deriveDarkAccent,
  isHexColor,
  MAX_DARK_ACCENT_LIFT,
  resolveAccent,
  EXTERNAL_LOGO_IMG_ATTRS,
  isBrandFormDirty,
  MAX_BRAND_NAME,
  MAX_LOGO_URL,
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

test("sanitizeLogoUrl REJECTS an over-length URL instead of truncating it", () => {
  // A signed CDN logo URL (S3/Cloudinary style) easily clears 500 chars.
  const signed = `https://cdn.acme.com/logo.png?X-Amz-Signature=${"a".repeat(MAX_LOGO_URL)}`;
  assert.ok(signed.length > MAX_LOGO_URL);
  // Pre-fix this returned `signed.slice(0, 500)` — a syntactically valid https URL
  // whose signature is cut in half, so it stores, round-trips, reports "Saved", and
  // 403s forever. A refusal (null) is what the editor can actually show.
  assert.equal(sanitizeLogoUrl(signed), null);
  assert.equal(sanitizeBrand({ logoUrl: signed }).logoUrl, null);

  // The boundary itself is still storable — the rule rejects LONGER, not "long".
  const exact = "https://a.co/" + "b".repeat(MAX_LOGO_URL - "https://a.co/".length);
  assert.equal(exact.length, MAX_LOGO_URL);
  assert.equal(sanitizeLogoUrl(exact), exact);
});

test("sanitizeBrand validates every field together", () => {
  assert.deepEqual(sanitizeBrand({ displayName: "  Acme  ", accentColor: "nope", logoUrl: "https://x/l.png" }), {
    displayName: "Acme",
    accentColor: null,
    accentDark: null,
    logoUrl: "https://x/l.png",
  });
  assert.deepEqual(sanitizeBrand(null), { displayName: null, accentColor: null, accentDark: null, logoUrl: null });
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

// -- The Spark Dark half of the accent contract ------------------------------
// Everything below pins the second theme. Before this, the accent was validated
// against the LIGHT paper only and then written verbatim into BOTH theme blocks
// by BrandStyle.tsx, so a hex that passed here still painted an illegible
// Spark Dark - and nothing in the app could tell you.

test("isHexColor is the ONE owner of the accent syntax rule", () => {
  // BrandingTab used to re-type this regex; the editor now asks this function, so
  // the warning it shows and the value the store accepts cannot drift apart.
  assert.equal(isHexColor("#d65a4a"), true);
  assert.equal(isHexColor("  #ABC  "), true);
  assert.equal(isHexColor("#12"), false);
  assert.equal(isHexColor("red"), false);
  assert.equal(isHexColor(""), false);
});

test("ACCENT_GROUNDS reads BOTH themes off brand.ts, and dark's label is NOT white", () => {
  // `text-white` is a ROLE: globals.css remaps --color-white to #1d2630 under
  // [data-theme="dark"], so the dark theme's on-accent label is DARK. Checking a
  // white label in both themes is precisely the bug this replaces.
  assert.equal(ACCENT_GROUNDS.light.canvas, "#fdf8ee");
  assert.equal(ACCENT_GROUNDS.light.onAccent, "#ffffff");
  assert.equal(ACCENT_GROUNDS.dark.canvas, "#141b24");
  assert.equal(ACCENT_GROUNDS.dark.onAccent, "#1d2630");
  assert.notEqual(ACCENT_GROUNDS.dark.onAccent, ACCENT_GROUNDS.light.onAccent);
});

test("accentIsLegible judges the theme it is asked about", () => {
  // The store's own round-trip accent. Measured: 6.87:1 white-on-accent and 6.49:1
  // against the cream canvas -> fine in Studio Light. On the dark grounds the SAME
  // literal is 2.23:1 (label) and 2.52:1 (canvas) -> below the 3:1 bar, which is
  // what shipping one hex into both blocks was doing.
  assert.equal(accentIsLegible("#0057b8", "light"), true);
  assert.ok(contrastRatio("#0057b8", ACCENT_GROUNDS.dark.canvas) < 3);
  assert.equal(accentIsLegible("#0057b8", "dark"), false);
  // A pale accent is the mirror image: unusable on the cream canvas, fine on ink.
  assert.equal(accentIsLegible("#ffff88", "light"), false);
  assert.equal(accentIsLegible("#ffff88", "dark"), true);
  // Absence is the product default in either theme; junk is legible in neither.
  for (const theme of ["light", "dark"] as const) {
    assert.equal(accentIsLegible(null, theme), true);
    assert.equal(accentIsLegible("", theme), true);
    assert.equal(accentIsLegible("chartreuse", theme), false);
  }
  // Default argument = light, so every pre-existing caller keeps its meaning.
  assert.equal(accentIsLegible("#0057b8"), accentIsLegible("#0057b8", "light"));
});

test("deriveDarkAccent gives #0057b8 a legible dark twin at the same hue", () => {
  const twin = deriveDarkAccent("#0057b8");
  assert.ok(twin, "a mid-blue brand accent must have a Spark Dark twin");
  assert.notEqual(twin, "#0057b8", "the twin must actually move - that was the bug");
  // How this was checked: the WCAG ratio is COMPUTED here against both real dark
  // grounds, not eyeballed. The raw accent measures 2.23 / 2.52; the twin clears 3.
  assert.ok(
    contrastRatio(twin!, ACCENT_GROUNDS.dark.onAccent) >= MIN_ACCENT_CONTRAST,
    `the dark label must read on the twin (got ${contrastRatio(twin!, ACCENT_GROUNDS.dark.onAccent)})`
  );
  assert.ok(
    contrastRatio(twin!, ACCENT_GROUNDS.dark.canvas) >= MIN_ACCENT_CONTRAST,
    `the twin must read as a focus ring on the dark canvas (got ${contrastRatio(twin!, ACCENT_GROUNDS.dark.canvas)})`
  );
  assert.equal(accentIsLegible(twin, "dark"), true);
  // Same hue family: blue stays blue (b is the dominant channel in both).
  assert.ok(twin!.startsWith("#00"), `expected a blue twin, got ${twin}`);
});

test("deriveDarkAccent leaves an accent that already reads on ink alone", () => {
  // The product's own coral measures 3.95 / 4.47 on the dark grounds, so there is
  // nothing to lift - the twin is the accent, normalized to 6 digits.
  assert.equal(deriveDarkAccent("#d65a4a"), "#d65a4a");
  assert.equal(deriveDarkAccent("#ABC"), deriveDarkAccent("#aabbcc"));
  assert.equal(deriveDarkAccent(null), null);
  assert.equal(deriveDarkAccent("not-a-color"), null);
});

test("deriveDarkAccent refuses rather than shipping a color the operator never chose", () => {
  // Near-black is perfectly legible in Studio Light (21:1 on white) and has NO
  // legible dark twin that is still near-black: reaching 3:1 on #141b24 needs a
  // mid-grey, past MAX_DARK_ACCENT_LIFT away from what was typed. The honest
  // answer is a refusal naming Spark Dark, not a silent substitution.
  assert.equal(accentIsLegible("#000000", "light"), true);
  assert.equal(deriveDarkAccent("#000000"), null);
  assert.equal(deriveDarkAccent("#111111"), null);
  // The cap is what makes that a refusal rather than a lift to grey.
  assert.equal(MAX_DARK_ACCENT_LIFT, 0.35);
});

test("resolveAccent is the write-door verdict: one reason per BRAND_* code", () => {
  const ok = resolveAccent("#0057B8");
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.accent, "#0057b8", "the light accent is stored AS TYPED");
  assert.equal(ok.ok && ok.accentDark, deriveDarkAccent("#0057b8"));

  // Absent / empty is "use the product default", never a refusal.
  for (const empty of [undefined, null, "", "   ", 42, {}]) {
    const v = resolveAccent(empty as unknown);
    assert.equal(v.ok, true, `${String(empty)} must be accepted as "no accent"`);
    assert.equal(v.ok && v.accent, null);
    assert.equal(v.ok && v.accentDark, null);
  }

  assert.deepEqual(resolveAccent("chartreuse"), { ok: false, reason: "invalid" });
  assert.deepEqual(resolveAccent("#000; } body { display:none"), { ok: false, reason: "invalid" });
  assert.deepEqual(resolveAccent("#ffff88"), { ok: false, reason: "illegible-light" });
  assert.deepEqual(resolveAccent("#000000"), { ok: false, reason: "illegible-dark" });
});

test("sanitizeBrand carries the derived twin and stays FAIL-SAFE on a bad value", () => {
  const b = sanitizeBrand({ accentColor: "#0057b8" });
  assert.equal(b.accentColor, "#0057b8");
  assert.equal(b.accentDark, deriveDarkAccent("#0057b8"));
  assert.notEqual(b.accentDark, b.accentColor, "the two theme blocks must not get the same literal");
  // The READ path degrades (the write path refuses): a stored value that predates a
  // rule must never throw its way out of getBrand().
  for (const bad of ["#ffff88", "#000000", "nope"]) {
    const dropped = sanitizeBrand({ accentColor: bad });
    assert.equal(dropped.accentColor, null, `${bad} must drop to the product default on read`);
    assert.equal(dropped.accentDark, null, "no accent means no twin");
  }
  // A caller cannot inject a twin: it is DERIVED from the light accent, always.
  assert.equal(sanitizeBrand({ accentColor: "#0057b8", accentDark: "#ff0000" }).accentDark, deriveDarkAccent("#0057b8"));
});
