import { test } from "node:test";
import assert from "node:assert/strict";
import { pinLinkLocale } from "./candidate-link-locale.ts";

test("a bare link gains ?lang=<locale>", () => {
  assert.equal(pinLinkLocale("https://kp.example/offer/tk-1", "cs"), "https://kp.example/offer/tk-1?lang=cs");
});

test("a link that already carries a query gets &lang=", () => {
  assert.equal(pinLinkLocale("https://kp.example/offer/tk-1?ref=mail", "de"), "https://kp.example/offer/tk-1?ref=mail&lang=de");
});

test("an already-pinned link is left alone (idempotent, never double-pinned)", () => {
  const pinned = "https://kp.example/data/tk-2?lang=fr";
  assert.equal(pinLinkLocale(pinned, "en"), pinned);
  const mid = "https://kp.example/data/tk-2?lang=fr&x=1";
  assert.equal(pinLinkLocale(mid, "en"), mid);
});

test("a base-less relative link (APP_BASE_URL unset on the heartbeat) still pins", () => {
  assert.equal(pinLinkLocale("/offer/tk-3", "en"), "/offer/tk-3?lang=en");
});
