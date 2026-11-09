// The designed CV's line length - render every reference CV in every template and count
// the characters on each wrapped line of running text (bullets, summary, lede).
//
//   npm run cv:lines [-- --template studio,classic] [--json] [--css extra.css]
//
// Registry recruiting/cv-presentation-and-parseability, technique
// type-scale-density-and-page-budget: "Line length about 55-90 characters. Wider lines
// slow reading." The round trip (roundtrip.mjs) measures the type scale, the page count
// and the reading order; nothing measured the measure, and a single-flow A4 sheet at
// 10-10.5pt with 14-19mm side padding can sit past 90 without any check seeing it.
//
// A line is FULL when it is not the last line of its block: a last line is as short as
// the sentence happens to end, so it says nothing about the measure. The figure per
// template is the median and the p90 of full-line lengths across every reference CV, and
// the share of full lines over 90 characters.
//
// --css appends a stylesheet after cv.css, so an alternative can be measured on the same
// inputs before it is written into cv.css (the A/B arm).
//
// A DEV TOOL like the round trip: it needs playwright-core's Chromium, nothing else. It
// reports and never fails: measured 2026-10-31, the one-flow templates set 103-113
// characters and every cap that brought them under 90 (36em, 38em, 40em on the running
// text) pushed the fourteen-year reference CV from one exact page to a second page 4-8%
// full - the spill the same technique forbids. The measure is a trade against the page,
// not a free fix, so the owner of a template decides it with both numbers in front of
// them (this report and `npm run cv:roundtrip`).

import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CV_DIR = path.join(ROOT, "app", "features", "jobseeker", "cv");

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (url.endsWith(".tsx")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      const out = ts.transpileModule(source, {
        fileName: fileURLToPath(url),
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("template")?.split(",").filter(Boolean);
const extraCss = opt("css") ? readFileSync(path.resolve(opt("css")), "utf8") : "";

const imp = (p) => import(pathToFileURL(p).href);
const [{ createElement }, { renderToStaticMarkup }] = await Promise.all([import("react"), import("react-dom/server")]);
const { DesignedCv } = await imp(path.join(CV_DIR, "DesignedCv.tsx"));
const { REFERENCE_CVS } = await imp(path.join(CV_DIR, "__fixtures__", "referenceCvs.ts"));
const query = await imp(path.join(CV_DIR, "cvQuery.ts"));
const TEMPLATES = query.CV_TEMPLATES;
const DEFAULT = query.CV_DESIGN_DEFAULT.template;
const accent = query.CV_DESIGN_DEFAULT.accent;

// The sheet's own static faces inlined (the faces the PDF route prints in), and the paper
// tokens from globals.css - the same page the round trip builds.
const globals = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const tokens = new Map();
for (const m of globals.matchAll(/(--color-cv-[a-z-]+)\s*:\s*([^;]+);/g)) if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
const FONTS = path.join(ROOT, "public", "fonts", "cv");
const cvCss = readFileSync(path.join(CV_DIR, "cv.css"), "utf8").replace(
  /url\((["']?)\/fonts\/cv\/([a-z0-9-]+\.woff2)\1\)/g,
  (_, _q, file) => `url(data:font/woff2;base64,${readFileSync(path.join(FONTS, file)).toString("base64")})`
);
const rootCss = `:root{${[...tokens].map(([k, v]) => `${k}:${v}`).join(";")}} html,body{margin:0;background:#fff}`;
const pageHtml = (doc, template) =>
  `<!doctype html><html lang="${doc.lang}"><head><meta charset="utf-8"><style>${rootCss}\n${cvCss}\n${extraCss}</style></head><body>${renderToStaticMarkup(
    createElement(DesignedCv, { doc, template, accent })
  )}</body></html>`;

/** In the page: characters per visual line of every running-text block. */
function linesInPage() {
  const blocks = document.querySelectorAll(".cvsheet .cv-bullets li, .cvsheet .cv-summary, .cvsheet .cv-objective");
  const out = [];
  for (const block of blocks) {
    const tops = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.data.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) tops.push(Math.round(r.top));
      }
    }
    const lines = [];
    let last = null;
    for (const t of tops) {
      if (last === null || Math.abs(t - last) > 3) lines.push(0);
      lines[lines.length - 1]++;
      last = t;
    }
    // Every line but the last is full.
    out.push(...lines.slice(0, -1));
  }
  return out;
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  const page = await (await browser.newContext()).newPage();
  for (const template of TEMPLATES) {
    if (only && !only.includes(template)) continue;
    const full = [];
    for (const ref of REFERENCE_CVS) {
      await page.setContent(pageHtml(ref.doc, template), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      full.push(...(await page.evaluate(`(${linesInPage.toString()})()`)));
    }
    rows.push({ template, lines: full.length, median: pct(full, 0.5), p90: pct(full, 0.9), max: Math.max(...full), over90: full.filter((n) => n > 90).length });
  }
} finally {
  await browser.close();
}

if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
else {
  console.log("template | full lines | median chars | p90 | max | over 90");
  for (const r of rows) console.log(`${r.template}${r.template === DEFAULT ? "*" : ""} | ${r.lines} | ${r.median} | ${r.p90} | ${r.max} | ${r.over90} (${Math.round((100 * r.over90) / r.lines)}%)`);
  console.log("\nFull line = every line of a bullet, summary or lede but its last. Target 55-90 (registry type-scale-density-and-page-budget). * = the default template");
}
