#!/usr/bin/env node
// i18n catalog parity + sanity check — the CI gate that keeps translation gaps
// from shipping. For every non-default locale it asserts:
//   1. no key present in the default (en) catalog is MISSING,
//   2. no key exists that the default does NOT have (an orphan / typo),
//   3. every message has balanced ICU `{ }` braces and matching placeholder
//      names against the default (so `{count}` in en isn't `{pocet}` in cs).
// Exits non-zero (failing CI / the i18n:check script) on any problem. The
// compile-time half of gap prevention is the next-intl Messages augmentation in
// global.d.ts (unknown keys are TS errors); this is the cross-locale half.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES_DIR = join(REPO_ROOT, "messages");
// The shared-primitive blind spot. The eslint i18n rule runs in `jsx-text-only`
// mode, so it structurally cannot see an ATTRIBUTE — and a hardcoded aria-label
// in a shared primitive is inherited by every consumer, which is how Modal
// shipped an English-only "Close" twice in a 4-locale app. `jsx-only` is the
// only plugin mode that reads attributes and it also flags every string inside
// a JSX expression container, including the message keys passed to t() — 159
// false positives when measured against the already-graduated file set, so the
// rule cannot be extended. This grep closes exactly that gap for exactly the
// attribute that matters. `aria-label` is unambiguous: unlike `title`, nothing
// in this tree uses it as a component prop, so a literal match is always a real
// untranslated accessible name.
const PRIMITIVES_DIR = join(REPO_ROOT, "app", "_components");
const HARDCODED_ARIA = /aria-label="[^"{]/;
const LINE_BREAK = /\r?\n/;
const DEFAULT_LOCALE = "en";

// Full ICU compile is the authoritative syntax check (the brace-balance check
// below is the dependency-free fast-fail). next-intl ships intl-messageformat,
// so we reuse the SAME parser next-intl uses at runtime — a message that fails
// here (e.g. a malformed `{n, plural, …}` with bad Czech categories) is one that
// would throw on render. Optional: if the dep can't be loaded, we degrade to the
// brace check rather than failing the gate spuriously.
let IntlMessageFormat = null;
try {
  const mod = await import("intl-messageformat");
  IntlMessageFormat = mod.IntlMessageFormat ?? mod.default;
} catch {
  /* parser unavailable — brace-balance check still runs */
}

// The ICU AST parser (same family next-intl uses) lets us extract the REAL
// argument names — not the plural/select BRANCH literals a naive `{…}` regex
// mistakes for placeholders (e.g. `{n, plural, one {is} other {are}}` would
// otherwise read "is"/"are" as variables and flag every translated branch).
let icuParse = null;
let ICU_TYPE = null;
try {
  const mod = await import("@formatjs/icu-messageformat-parser");
  icuParse = mod.parse;
  ICU_TYPE = mod.TYPE;
} catch {
  /* parser unavailable — argNames falls back to the regex below */
}

function icuError(value, locale) {
  if (typeof value !== "string" || !IntlMessageFormat) return null;
  try {
    new IntlMessageFormat(value, locale);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `invalid ICU message — ${msg}`;
  }
}

/** Flatten nested catalog objects to dotted keys: { a: { b: "x" } } -> { "a.b": "x" }. */
function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

function loadCatalog(file) {
  return flatten(JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf-8")));
}

/** The argument + rich-tag names a message references — used to assert en and a
 *  translation share the same variables/tags. AST-based when the parser is
 *  available (so plural/select branch LITERALS like `one {is}` are correctly NOT
 *  treated as placeholders, and rich tags `<b>` are compared); otherwise falls
 *  back to a `{name}` regex. */
function argNames(value) {
  if (typeof value !== "string") return new Set();
  if (icuParse && ICU_TYPE) {
    const names = new Set();
    let ast;
    try {
      ast = icuParse(value);
    } catch {
      return names; // a genuine parse error is reported separately by icuError
    }
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === ICU_TYPE.argument || n.type === ICU_TYPE.number || n.type === ICU_TYPE.date || n.type === ICU_TYPE.time) {
          names.add(n.value);
        } else if (n.type === ICU_TYPE.select || n.type === ICU_TYPE.plural) {
          names.add(n.value);
          for (const opt of Object.values(n.options)) walk(opt.value);
        } else if (n.type === ICU_TYPE.tag) {
          names.add(`<${n.value}>`);
          walk(n.children);
        }
      }
    };
    walk(ast);
    return names;
  }
  const names = new Set();
  const re = /\{\s*([a-zA-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(value))) names.add(m[1]);
  return names;
}

/** Returns a brace-balance error string for an ICU message, or null if balanced. */
function braceError(value) {
  if (typeof value !== "string") return null;
  let depth = 0;
  for (const ch of value) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return "a `}` appears before its `{`";
    }
  }
  return depth !== 0 ? "unbalanced `{` / `}` braces" : null;
}

const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
const defaultFile = `${DEFAULT_LOCALE}.json`;
if (!files.includes(defaultFile)) {
  console.error(`[i18n-check] missing default catalog messages/${defaultFile}`);
  process.exit(1);
}

const base = loadCatalog(defaultFile);
const baseKeys = Object.keys(base);
const problems = [];

// Default catalog must itself be ICU-valid (brace balance + full compile).
for (const key of baseKeys) {
  const err = braceError(base[key]) || icuError(base[key], DEFAULT_LOCALE);
  if (err) problems.push(`${DEFAULT_LOCALE}: "${key}" — ${err}`);
}

for (const file of files) {
  if (file === defaultFile) continue;
  const locale = file.replace(/\.json$/, "");
  const catalog = loadCatalog(file);
  const keys = new Set(Object.keys(catalog));

  for (const key of baseKeys) {
    if (!keys.has(key)) {
      problems.push(`${locale}: missing key "${key}" (present in ${DEFAULT_LOCALE})`);
      continue;
    }
    const err = braceError(catalog[key]) || icuError(catalog[key], locale);
    if (err) problems.push(`${locale}: "${key}" — ${err}`);
    const baseVars = argNames(base[key]);
    const localeVars = argNames(catalog[key]);
    for (const v of baseVars) {
      if (!localeVars.has(v)) problems.push(`${locale}: "${key}" — missing placeholder {${v}}`);
    }
    for (const v of localeVars) {
      if (!baseVars.has(v)) problems.push(`${locale}: "${key}" — unexpected placeholder {${v}} (not in ${DEFAULT_LOCALE})`);
    }
  }
  for (const key of keys) {
    if (!(key in base)) problems.push(`${locale}: orphan key "${key}" (not in ${DEFAULT_LOCALE})`);
  }
}

// ---- Shared primitives may not hardcode an accessible name --------------------
function tsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

let primitiveFileCount = 0;
for (const file of tsxFiles(PRIMITIVES_DIR)) {
  primitiveFileCount++;
  const lines = readFileSync(file, "utf8").split(LINE_BREAK);
  lines.forEach((line, i) => {
    if (HARDCODED_ARIA.test(line)) {
      problems.push(
        `${relative(REPO_ROOT, file).split("\\").join("/")}:${i + 1} — hardcoded aria-label in a shared primitive; ` +
          `route it through useTranslations() so all 4 locales get it`
      );
    }
  });
}

if (problems.length) {
  console.error(`[i18n-check] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `[i18n-check] OK — ${baseKeys.length} keys, ${files.length} locale(s) in parity; ` +
    `${primitiveFileCount} shared primitive(s) free of hardcoded aria-labels.`
);
