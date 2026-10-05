import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { headlineFit, taggedTexts, textEm, widestEm } from "./headlineFit.ts";

/*
 * The display-line fits (css/land-landing.css `--h1-em`, `--fh-em`, …) scale a line down only when its estimated
 * em width exceeds the room it has. English is the design: these pin that its lines stay under every threshold, so a
 * table or safety change can never quietly shrink the English page, and that the estimates stay close to what
 * Chromium measured when the table was made.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = (loc: string) => JSON.parse(readFileSync(path.join(here, "../../../../messages", `${loc}.json`), "utf8"));

test("the estimate tracks Chromium's measure of Bricolage ExtraBold within a few percent", () => {
  // em widths measured in the page at 48px, -.03em tracking (Playwright, canvas measureText == DOM range)
  const measured: [string, number][] = [
    ["Votre recrutement,", 8.488],
    ["pilote automatique", 8.439],
    ["Ihr Recruiting,", 6.23],
    ["Your hiring,", 5.023],
    ["autopilot", 4.004]
  ];
  for (const [text, em] of measured) {
    const ratio = textEm(text) / em;
    assert.ok(ratio > 0.98 && ratio < 1.04, `${text}: ${textEm(text)} vs ${em}`);
  }
});

test("English never reaches a fit threshold, so the English page is drawn at the prototype's sizes", () => {
  const en = catalog("en");
  const hero = headlineFit(en.landing.hero.title);
  // phone: (100cqi - 8px) / em at 390px, where 100cqi = 350px and the headline is 12.2vw = 47.58px
  assert.ok(hero.line <= (350 - 8) / 47.58, `hero line ${hero.line}em`);
  // desktop: 830 design px of budget at 100 design px of type
  assert.ok(hero.line <= 8.3, `hero line ${hero.line}em`);
  // the ring's heading: 550 design px at 62
  assert.ok(headlineFit(en.landing.features.heading).line <= 550 / 62);
  // every scene name: 860 design px at 70; every hovered name: 1000 at 72
  for (const f of Object.values(en.landing.features) as { title?: string }[]) {
    if (!f.title) continue;
    assert.ok(headlineFit(f.title).line <= 860 / 70, f.title);
    assert.ok(headlineFit(f.title).line <= 1000 / 72, f.title);
  }
  // About's stamp: 18u of block at 5.3u; the phone block's 198px at 46px
  const seal = widestEm([en.aboutPage.art.hired.seal.toUpperCase()], 0.07) + 0.07;
  assert.ok(seal <= 18 / 5.3 && seal <= 198 / 46, `seal ${seal}em`);
});

test("the longer locales that overflowed are the ones the fits catch", () => {
  assert.ok(headlineFit(catalog("fr").landing.hero.title).unit > (350 - 8) / 47.58);
  assert.ok(headlineFit(catalog("de").landing.features.heading).line > 550 / 62);
  assert.deepEqual(taggedTexts("<line>a</line> <line><em>b c</em></line>", "line"), ["a", "b c"]);
});
