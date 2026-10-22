import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LOGO_BYTES, validateLogoUpload } from "./brand-logo.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const wrap = (inner: string, attrs = "") => enc(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("PNG is decided by magic bytes, not by a name or header", () => {
  assert.deepEqual(validateLogoUpload(PNG), { ok: true, mime: "image/png" });
  assert.deepEqual(validateLogoUpload(enc("\x89PNG but not really")), { ok: false, code: "BRAND_LOGO_TYPE" });
});

test("size: empty and past-the-cap are refused", () => {
  assert.deepEqual(validateLogoUpload(new Uint8Array(0)), { ok: false, code: "BRAND_LOGO_EMPTY" });
  assert.deepEqual(validateLogoUpload(new Uint8Array(MAX_LOGO_BYTES + 1)), { ok: false, code: "BRAND_LOGO_TOO_LARGE" });
  assert.equal(validateLogoUpload(PNG).ok, true);
});

test("a plain SVG is accepted, including xml prolog, comments, gradients and #refs", () => {
  const svg = `<?xml version="1.0"?><!-- logo --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 4 4">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><style>.a{fill:url(#g)}</style></defs>
    <g><path class="a" d="M0 0L4 4"/><use xlink:href="#p"/><text>Acme &amp; Co</text></g></svg>`;
  assert.deepEqual(validateLogoUpload(enc(svg)), { ok: true, mime: "image/svg+xml" });
});

test("hostile SVGs are refused as unsafe", () => {
  const hostile: Array<[string, Uint8Array]> = [
    ["script", wrap("<script>alert(1)</script>")],
    ["script uppercase", wrap("<SCRIPT>alert(1)</SCRIPT>")],
    ["foreignObject", wrap("<foreignObject><div/></foreignObject>")],
    ["onload", enc(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`)],
    ["onclick on child", wrap(`<rect onclick="x()"/>`)],
    ["external href", wrap(`<use href="https://evil.example/a.svg#x"/>`)],
    ["external xlink:href", wrap(`<use xlink:href="//evil.example/a.svg"/>`)],
    ["javascript href via entity", wrap(`<use href="&#106;avascript:alert(1)"/>`)],
    ["anchor", wrap(`<a href="#x"><rect/></a>`)],
    ["image element", wrap(`<image href="#x"/>`)],
    ["animate", wrap(`<animate attributeName="href" to="javascript:alert(1)"/>`)],
    ["css import", wrap(`<style>@import url(https://evil.example/x.css);</style>`)],
    ["css external url", wrap(`<style>.a{background:url(https://evil.example/x)}</style>`)],
    ["style attr external url", wrap(`<rect style="fill:url(http://evil.example/x)"/>`)],
    ["doctype/entities", enc(`<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`)],
    ["cdata", wrap(`<style><![CDATA[.a{}]]></style>`)],
    ["unquoted attribute", wrap(`<rect width=10/>`)],
    ["mismatched tags", enc(`<svg xmlns="http://www.w3.org/2000/svg"><g></svg></g>`)],
    ["second root", enc(`<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>`)],
    ["unclosed", enc(`<svg xmlns="http://www.w3.org/2000/svg"><g>`)],
    ["wrong root", enc(`<html><body/></html>`)],
  ];
  for (const [name, bytes] of hostile) {
    const v = validateLogoUpload(bytes);
    assert.equal(v.ok, false, name);
    if (!v.ok) assert.ok(v.code === "BRAND_LOGO_UNSAFE" || v.code === "BRAND_LOGO_TYPE", `${name}: ${v.code}`);
  }
  // The headline cases carry the UNSAFE code specifically.
  for (const i of [0, 1, 2, 3, 5, 6]) assert.equal((validateLogoUpload(hostile[i][1]) as { code: string }).code, "BRAND_LOGO_UNSAFE");
});

test("the prolog strip takes only an xml declaration, never a processing instruction named like one", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
  for (const pi of [
    `<?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?>`,
    `<?xml-stylesheet type="text/css" href="data:text/css,*{}"?>`,
    `<?xmlfoo?>`,
  ]) {
    assert.deepEqual(validateLogoUpload(enc(pi + svg)), { ok: false, code: "BRAND_LOGO_UNSAFE" }, pi);
  }
  assert.deepEqual(validateLogoUpload(enc(`<?xml version="1.0" encoding="UTF-8"?>${svg}`)), { ok: true, mime: "image/svg+xml" });
  assert.deepEqual(validateLogoUpload(enc(`<?xml?>${svg}`)), { ok: true, mime: "image/svg+xml" });
});

test("non-markup, non-PNG bytes are a wrong type, not an unsafe one", () => {
  assert.deepEqual(validateLogoUpload(enc("GIF89a")), { ok: false, code: "BRAND_LOGO_TYPE" });
  assert.deepEqual(validateLogoUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), { ok: false, code: "BRAND_LOGO_TYPE" });
});
