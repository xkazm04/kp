// The designed CV's round trip - render every reference CV in every template to PDF,
// extract it two ways, and check the extraction against the model it was rendered from.
//
//   npm run cv:roundtrip [-- --out DIR] [--png] [--json] [--template studio,classic] [--accent cobalt] [--system-faces]
//
// Registry recruiting/cv-presentation-and-parseability, techniques
// parse-safe-reading-order and export-format-and-round-trip-verification: "when a
// template or layout engine changes, re-run the round trip on a fixed set of reference
// documents - short, long, career change, non-Latin diacritics, two pages - and fail the
// change on any regression."
//
// WHY STATIC, NOT THROUGH THE SERVER. The sheet is one hook-free component
// (DesignedCv.tsx) over one stylesheet (cv.css), so it renders to HTML with no Next, no
// database and no session: this script transpiles the .tsx with the repo's own
// TypeScript, renders it with react-dom/server, and hands headless Chromium the page with
// the stylesheet inlined and the same `page.pdf` options the PDF route uses
// (app/_lib/jobseeker/cv-pdf.ts CV_PDF_OPTIONS). A dev server would add a login, a seeded
// profile and a port shared with other sessions, and change nothing about the bytes the
// check reads. The faces: the app loads Inter, Fraunces, Bricolage Grotesque and
// JetBrains Mono through next/font, which writes each as @font-face rules plus one
// `--font-*` variable into a Next build's CSS. When a build (dev or production) has left
// them on disk, the page carries the product's own faces, inlined as data: URLs, so line
// breaks and page counts are the product's; without one - or with --system-faces - they
// fall back to the stylesheet's own fallbacks (Segoe UI / Georgia on Windows). Reading
// order and type sizes do not depend on the face; glyph widths do, and so does the font
// FILE: the product's variable, subset-split faces print as Type 3 fonts that a
// content-order extractor splits mid-word (the report says so when it sees them), which
// the system faces hid until 2026-09-28. --system-faces keeps the layout-only reading.
//
// A DEV TOOL, declared as an npm script, not a CI gate: it needs playwright-core's
// Chromium and Python with pypdf + PyMuPDF (+ pypdfium2 for --png), none of which the
// keyless unit job has. The pure half - the checker - is held by
// app/features/jobseeker/cv/cvRoundTrip.test.ts in `npm run test:unit`.
//
// Exit code: 1 when the DEFAULT template fails any check on any reference CV.

import { registerHooks } from "node:module";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CV_DIR = path.join(ROOT, "app", "features", "jobseeker", "cv");

// .tsx -> JS with the repo's TypeScript; a stylesheet import is a no-op (cv.css is inlined
// into the page below). Everything else goes through scripts/test-alias-loader.mjs.
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
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(opt("out") ?? path.join(os.tmpdir(), "kp-cv-roundtrip"));
mkdirSync(outDir, { recursive: true });

const imp = (p) => import(pathToFileURL(p).href);
const [{ createElement }, { renderToStaticMarkup }] = await Promise.all([import("react"), import("react-dom/server")]);
const { DesignedCv } = await imp(path.join(CV_DIR, "DesignedCv.tsx"));
const { REFERENCE_CVS } = await imp(path.join(CV_DIR, "__fixtures__", "referenceCvs.ts"));
const { checkRoundTrip, cvReadingLines, normText, ROUND_TRIP_CHECKS } = await imp(path.join(CV_DIR, "cvRoundTrip.ts"));
const query = await imp(path.join(CV_DIR, "cvQuery.ts"));
const docModule = await imp(path.join(CV_DIR, "cvDocument.ts"));
const pdfModule = await imp(path.join(ROOT, "app", "_lib", "jobseeker", "cv-pdf.ts"));
const budget = await imp(path.join(CV_DIR, "cvPageBudget.ts"));
const TEMPLATES = query.CV_TEMPLATES ?? docModule.CV_TEMPLATES;
const DEFAULT = query.CV_DESIGN_DEFAULT.template;
const PDF_OPTIONS = pdfModule.CV_PDF_OPTIONS ?? { preferCSSPageSize: true, printBackground: true };
const only = opt("template")?.split(",").filter(Boolean);
// The accent changes no word and no position, so the checks read the same; it is here for
// looking at the pages (--png).
const accent = query.isCvAccent(opt("accent")) ? opt("accent") : query.CV_DESIGN_DEFAULT.accent;

// The paper tokens, from the one place they are declared.
const globals = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const tokens = new Map();
for (const m of globals.matchAll(/(--color-cv-[a-z-]+)\s*:\s*([^;]+);/g)) if (!tokens.has(m[1])) tokens.set(m[1], m[2].trim());
// The sheet's OWN faces (cv.css @font-face, public/fonts/cv/ - static, one file per weight,
// built by scripts/cv/build-cv-fonts.py): the page here is set from a string, so their
// site-relative URLs are inlined as data: URLs and the PDF is cut in the exact faces the
// product ships.
const CV_FONTS_DIR = path.join(ROOT, "public", "fonts", "cv");
const cvCss = readFileSync(path.join(CV_DIR, "cv.css"), "utf8").replace(
  /url\((["']?)\/fonts\/cv\/([a-z0-9-]+\.woff2)\1\)/g,
  (_, _q, file) => `url(data:font/woff2;base64,${readFileSync(path.join(CV_FONTS_DIR, file)).toString("base64")})`
);

/** The faces the sheet names, as next/font declares them: `--font-*` -> its family list
 *  and the @font-face rules behind it, each font file inlined as a data: URL. Read from
 *  whatever Next build is on disk (`next dev` writes .next/dev, `next build` .next); a
 *  variable no build declares is simply absent. */
const FACE_VARS = ["--font-inter", "--font-fraunces", "--font-bricolage", "--font-me-mono"];
function productFaces() {
  const found = new Map();
  for (const dir of [path.join(ROOT, ".next", "dev", "static", "chunks"), path.join(ROOT, ".next", "static", "chunks")]) {
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".css"));
    } catch {
      continue; // no build of this kind on disk
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const css = readFileSync(file, "utf8");
      if (!css.includes("@font-face")) continue;
      const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
      for (const m of css.matchAll(/(--font-[a-z-]+)\s*:\s*([^;}]+)/g)) {
        if (!FACE_VARS.includes(m[1]) || found.has(m[1])) continue;
        const families = m[2].split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
        const own = faces.filter((f) => families.includes((/font-family:\s*([^;]+);/.exec(f)?.[1] ?? "").trim().replace(/^["']|["']$/g, "")));
        if (!own.length) continue;
        const inlined = own.map((f) =>
          f.replace(/url\((["']?)([^)"']+)\1\)/g, (_, _q, ref) => `url(data:font/woff2;base64,${readFileSync(path.resolve(path.dirname(file), ref)).toString("base64")})`)
        );
        found.set(m[1], { value: m[2].trim(), css: inlined.join("\n") });
      }
    }
  }
  return found;
}
const faces = flag("system-faces") ? new Map() : productFaces();
// Without a build, the variables name the stylesheet's own fallbacks, so the sheet's faces
// resolve instead of going invalid (cv.css gives the newer faces a var() fallback itself).
const FALLBACK_FACES = { "--font-inter": `"Segoe UI",Roboto,Arial`, "--font-fraunces": `Georgia,"Times New Roman"` };
const faceVars = FACE_VARS.map((v) => (faces.has(v) ? `${v}:${faces.get(v).value}` : FALLBACK_FACES[v] ? `${v}:${FALLBACK_FACES[v]}` : null)).filter(Boolean);
const rootCss = `${[...faces.values()].map((f) => f.css).join("\n")}\n:root{${[...tokens].map(([k, v]) => `${k}:${v}`).join(";")};${faceVars.join(";")}} html,body{margin:0;background:#fff}`;
const faceNote = faces.size ? `product faces from the Next build: ${[...faces.keys()].join(", ")}` : "system fallback faces (no Next build on disk, or --system-faces)";

function pageHtml(doc, template) {
  const sheet = renderToStaticMarkup(createElement(DesignedCv, { doc, template, accent }));
  return `<!doctype html><html lang="${doc.lang}"><head><meta charset="utf-8"><title>kp</title><style>${rootCss}\n${cvCss}</style></head><body>${sheet}</body></html>`;
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ headless: true });
const rendered = [];
try {
  const page = await (await browser.newContext()).newPage();
  for (const ref of REFERENCE_CVS) {
    for (const template of TEMPLATES) {
      if (only && !only.includes(template)) continue;
      await page.setContent(pageHtml(ref.doc, template), { waitUntil: "load" });
      // The route's own title step (cv-pdf.ts renderOnce): document.title at print time.
      await page.evaluate((t) => {
        document.title = t;
        return document.fonts.ready.then(() => true);
      }, pdfModule.cvPdfTitle(ref.doc.name));
      // The designer's own estimate, measured the designer's way on the screen layout, with
      // its printed foot (CvDesigner SHEET_FOOT_MM: none - cv.css drops the sheet's bottom
      // padding in print, the page's own margin is the foot).
      const lengthMm = await page.evaluate(`(${budget.measureSheetLengthMm.toString()})(document.querySelector(".cvsheet"), 0)`);
      const bytes = await page.pdf(PDF_OPTIONS);
      const file = path.join(outDir, `lotq2-${template}-${ref.id}.pdf`);
      writeFileSync(file, bytes);
      rendered.push({ ref, template, file, lengthMm, estimate: budget.cvPageVerdict(lengthMm, budget.cvYearsOf(ref.doc)) });
    }
  }
} finally {
  await browser.close();
}

const python = process.env.KP_PYTHON || (process.platform === "win32" ? "python" : "python3");
const pyArgs = [path.join(ROOT, "scripts", "cv", "extract_pdf.py"), ...(flag("png") ? ["--png", outDir] : []), ...rendered.map((r) => r.file)];
const py = spawnSync(python, pyArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (py.status !== 0) {
  console.error(`extract_pdf.py failed (needs pypdf + PyMuPDF${flag("png") ? " + pypdfium2" : ""}):\n${py.stderr}`);
  process.exit(2);
}
const extracted = JSON.parse(py.stdout);

// ── measure ────────────────────────────────────────────────────────────────────────

function typeScale(ex, doc) {
  const bySize = new Map();
  for (const s of ex.spans) bySize.set(s.size, (bySize.get(s.size) ?? 0) + s.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const dates = new Set([...doc.experience, ...(doc.projects ?? [])].map((r) => r.dates).filter(Boolean).map(normText));
  const dateSpans = ex.spans.filter((s) => dates.has(normText(s.text)));
  const nameSpan = ex.spans.find((s) => normText(s.text) === normText(doc.name));
  // A level is a size that sets real text (>= 8 characters across the sheet).
  const levels = [...bySize].filter(([, n]) => n >= 8).map(([s]) => s).sort((a, b) => b - a);
  return {
    body,
    date: dateSpans.length ? Math.min(...dateSpans.map((s) => s.size)) : null,
    dateColor: dateSpans[0]?.color ?? null,
    name: nameSpan?.size ?? null,
    levels,
  };
}

/** Token sequence of the content-order extraction vs the sheet's document order. */
function readingMatches(ex, doc) {
  const want = (normText(cvReadingLines(doc).join(" ")).match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  const got = (normText(ex.content.join(" ")).match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  const nameAgain = (normText(doc.name).match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
  // A running head on page two repeats the name; it is not part of the flow.
  const strip = (x) => x.split(nameAgain).join(" ").replace(/\s+/g, " ").trim();
  return strip(got) === strip(want);
}

const rows = [];
for (const r of rendered) {
  const ex = extracted[r.file];
  const content = checkRoundTrip(r.ref.doc, ex.content.join("\n"));
  const positional = checkRoundTrip(r.ref.doc, ex.positional.join("\n"));
  // How full the last page really is: its lowest text, inside the 10mm head and foot.
  const MM = 25.4 / 72;
  const lastBottom = Math.max(0, ...ex.spans.filter((s) => s.page === ex.pages).map((s) => s.y1));
  const lastFill = ex.pages === 1 ? 1 : Math.max(0, lastBottom * MM - 10) / budget.CV_NEXT_PAGE_MM;
  rows.push({ template: r.template, cv: r.ref.id, pages: ex.pages, lengthMm: Math.round(r.lengthMm), estimate: r.estimate, lastFill, fonts: ex.fonts, tagged: ex.tagged, title: ex.title, bytes: ex.bytes, scale: typeScale(ex, r.ref.doc), content, positional, reading: readingMatches(ex, r.ref.doc), png: ex.png ?? [] });
}

if (flag("json")) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const mark = (ok) => (ok ? "pass" : "FAIL");
  const short = { nameFirst: "name", entriesTogether: "entry", bulletsWhole: "bullet", nothingMissing: "missing", diacritics: "diacr", nothingForeign: "foreign" };
  console.log(`round trip -> ${outDir}\n${faceNote}\n`);
  console.log(["template", "cv", "pages", "est.", "last page", "budget", "body pt", "date pt", "date colour", "name pt", "levels", "reading=DOM", ...ROUND_TRIP_CHECKS.map((c) => `C:${short[c]}`), ...ROUND_TRIP_CHECKS.map((c) => `P:${short[c]}`)].join(" | "));
  for (const row of rows) {
    console.log(
      [
        row.template + (row.template === DEFAULT ? "*" : ""),
        row.cv,
        row.pages,
        row.estimate.pages,
        `${Math.round(row.lastFill * 100)}%`,
        `${row.estimate.budget}${row.estimate.over ? " OVER" : row.estimate.sparse ? " SPARSE" : ""}`,
        row.scale.body,
        row.scale.date,
        row.scale.dateColor,
        row.scale.name,
        row.scale.levels.length,
        row.reading ? "yes" : "NO",
        ...ROUND_TRIP_CHECKS.map((c) => mark(row.content.checks[c])),
        ...ROUND_TRIP_CHECKS.map((c) => mark(row.positional.checks[c])),
      ].join(" | ")
    );
  }
  console.log("\nC: = content order (pypdf) · P: = positional (PyMuPDF words by y, then x) · * = the default template\n");
  for (const row of rows) {
    const f = [...row.content.findings.map((x) => `C ${x.check}: ${x.detail}`), ...row.positional.findings.map((x) => `P ${x.check}: ${x.detail}`)];
    if (f.length) console.log(`${row.template}/${row.cv}\n  ${f.slice(0, 8).join("\n  ")}${f.length > 8 ? `\n  ... ${f.length - 8} more` : ""}`);
  }
  console.log("\nexport properties (the file, not the page):");
  // A font with no name and no file is a Type 3 font: glyphs drawn as procedures, which is
  // how Chromium's PDF writer carries a VARIABLE web font.
  const fontName = (f) => f || "unnamed Type 3";
  let type3 = false;
  for (const row of rows.filter((x) => x.template === DEFAULT)) {
    const unembedded = row.fonts.filter(([, ext]) => ext === "n/a").map(([f]) => fontName(f));
    if (row.fonts.some(([f, ext]) => !f && ext === "n/a")) type3 = true;
    console.log(`  ${row.cv}: title ${JSON.stringify(row.title)} · ${Math.round(row.bytes / 1024)} KB · tagged ${row.tagged ? "yes" : "NO"} · fonts ${row.fonts.length}${unembedded.length ? ` NOT EMBEDDED: ${unembedded.join(", ")}` : " all embedded"}`);
  }
  const verdict = TEMPLATES.map((t) => {
    const mine = rows.filter((x) => x.template === t);
    return mine.length ? `${t}: ${mine.every((x) => x.content.pass && x.positional.pass) ? "PASS" : "FAIL"}` : null;
  }).filter(Boolean);
  console.log(`\n${verdict.join(" · ")}`);
  if (type3)
    console.log(
      "\nnote: the faces printed as Type 3 fonts. next/font serves variable fonts split into unicode-range subsets\n" +
        "(latin / latin-ext), so a word with a latin-ext letter switches font mid-word and a content-order extractor\n" +
        "breaks it (\"ú č etní\"). That is the FONT FILES, identical on every template - re-run with --system-faces to\n" +
        "see the layout alone. The cure is static faces covering both ranges in one file for the sheet."
    );
}

const defaultFails = rows.filter((x) => x.template === DEFAULT && !(x.content.pass && x.positional.pass));
process.exit(defaultFails.length ? 1 : 0);
