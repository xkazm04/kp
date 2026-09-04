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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
// The second half of the same blind spot, found in wave 25: the regex below only
// sees `aria-label="literal"`. RichTextEditor named its contentEditable surface
// `aria-label={ariaLabel || placeholder || "Rich text editor"}` — an EXPRESSION, so
// nothing looked at it, and the fallback name (the one a nameless textbox actually
// gets) was English on both builders that mount the editor. `ariaLabelLiterals`
// below reads inside the expression container instead: a string it contains is fine
// when it is a CALL ARGUMENT (a `t("key")` message key, which is what a localized
// name looks like) and a finding when it is anything else — a bare fallback, a
// ternary arm, a concatenation.
const PRIMITIVES_DIR = join(REPO_ROOT, "app", "_components");
const HARDCODED_ARIA = /aria-label="[^"{]/;
// The public marketing tree (`/`, `/about`, `/market`) is fully migrated and is
// held at eslint `error` — but the eslint rule reads TEXT NODES only, so it
// would not notice a hardcoded aria-label, title, placeholder or alt creeping
// back into a page that four locales read. These directories currently contain
// ZERO literal attributes, so sealing them costs nothing and keeps it that way.
// Scoped deliberately: widening this to all of `app/` is the right end state,
// but ~79 known attribute literals live outside these paths and would turn the
// gate red on unrelated work. That is a backlog item, not a side effect.
const SEALED_ATTR_DIRS = [
  join(REPO_ROOT, "app", "landing"),
  join(REPO_ROOT, "app", "about"),
  join(REPO_ROOT, "app", "market")
];
// The English-error leak. Route handlers return `{ error, code }` where `error`
// is canonical ENGLISH (for the server log and API consumers) and `code` is the
// stable machine code the UI is meant to localize through the `errors` namespace.
// Call sites kept writing `body.error ?? t("saveFailed")`, which looks like a
// fallback chain but is backwards: `error` is nearly always present, so the
// localized fallback never runs and every locale gets English. It was on 84 sites
// across 26 directories, including surfaces the eslint i18n rule already held at
// `error` — that rule reads JSX TEXT NODES, so it cannot see English arriving
// through a variable. Use useErrorMessage()/resolveErrorMessage instead
// (app/_lib/use-error-message.ts).
const UI_DIRS = ["app/features", "app/_components", "app/control", "app/apply", "app/offer", "app/schedule", "app/devcase", "app/jds"];
const ENGLISH_ERROR_LEAK = /\.error\s*(?:\|\||\?\?)|typeof\s+\w+\??\.error\s*===\s*"string"/;
// Verified non-UI uses of the same syntax: a change-detection cache key, a DB
// column write, and a server-side log field. Re-verify before adding to this list —
// it exists for values that never reach a user, not for exceptions.
const ERROR_LEAK_ALLOW = new Set([
  "app/_lib/task-view.ts",
  "app/_lib/scheduler-store.ts",
  "app/_lib/analyze-run.ts",
  "app/_lib/use-error-message.ts",
  // A background-task record's own diagnostic (tasksProviderTypes.Task), not an
  // API envelope — it carries no `code`, so there is nothing to resolve and
  // routing it through the resolver would discard the failure detail.
  "app/features/tools/devcases/DevAnalysisView.tsx",
  // Deliberate "carry the server's explanation verbatim" sites. These are NOT
  // store failures with a code — they are business-rule refusals and upstream
  // provider messages (a GitHub rate-limit note, a stage-move refusal) whose text
  // IS the information the user needs, and dropping it for a generic fallback
  // would lose the reason. Localizing them properly means giving the emitters in
  // _lib/pipeline-entry-action.ts and friends real codes first; until then the
  // honest state is "documented English", not a silent generic.
  "app/features/hiring/channels/useChannelsData.ts",
  "app/features/hiring/pipeline/pipelineTabHelpers.ts",
  // Dev-facing studio, deliberately outside the strict i18n lint (eslint.config.mjs).
]);
const HARDCODED_ATTR = /(?:^|\s)(aria-label|title|placeholder|alt)="[^"{]/;
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

/** JSON.parse keeps the LAST of two identical keys and says nothing - so a key pasted
 *  twice by two sessions splicing the same object (wave 7, 2026-09-02: five keys in all
 *  four catalogs) is invisible to every check that runs on the parsed object. Walk the
 *  text once and report a key that repeats inside one object, with its dotted path. */
function duplicateKeys(text) {
  const dups = [];
  const scopes = [new Set()];
  const path = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let key = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") { key += text[j + 1]; j += 2; } else { key += text[j++]; }
      }
      let k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ":") {
        const scope = scopes[scopes.length - 1];
        path[scopes.length - 1] = key;
        if (scope.has(key)) dups.push(path.slice(0, scopes.length).join("."));
        scope.add(key);
      }
      i = j + 1;
      continue;
    }
    if (c === "{") scopes.push(new Set());
    else if (c === "}") { scopes.pop(); path.length = scopes.length; }
    i++;
  }
  return dups;
}

function loadCatalog(file) {
  const text = readFileSync(join(MESSAGES_DIR, file), "utf-8");
  for (const key of duplicateKeys(text)) problems.push(`${file}: duplicate key ${key} (JSON.parse keeps the last silently)`);
  return flatten(JSON.parse(text));
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

const problems = [];
const base = loadCatalog(defaultFile);
const baseKeys = Object.keys(base);

// ---- The no-dash house rule (docs/i18n/contract.md §5) -----------------------
// `—` (U+2014) is banned in catalog copy outright; `–` (U+2013) survives only
// between numbers. This is gated rather than merely documented because a rule
// with no gate decays: within hours of the 2026-08-12 sweep clearing all four
// catalogs, a parallel session added four new keys carrying em dashes, entirely
// reasonably — it had no way to know. Prose is a shared surface, so the check
// belongs where the other catalog invariants already live.
//
// "Numeric" includes a placeholder that renders a number (`{min}–{max}`,
// `{lo, number}–{hi, number}`) and an abbreviated magnitude (`120k–165k`), not
// just a bare digit — otherwise every legitimate salary band fails.
const RANGE_LEFT = /(?:\d[kKmM%]?|\})\s*$/;
const RANGE_RIGHT = /^\s*(?:\d|\{)/;
function dashError(value) {
  if (typeof value !== "string") return null;
  if (value.includes("—")) {
    return "em dash (U+2014) in catalog copy — recast into sentence syntax (a full stop, a colon before a list, a comma pair, or parentheses in a tight label). See docs/i18n/contract.md §5";
  }
  let i = -1;
  while ((i = value.indexOf("–", i + 1)) !== -1) {
    if (!(RANGE_LEFT.test(value.slice(0, i)) && RANGE_RIGHT.test(value.slice(i + 1)))) {
      const ctx = value.slice(Math.max(0, i - 20), i + 21);
      return `en dash (U+2013) used as prose punctuation in "…${ctx}…" — it is only allowed between numbers. See docs/i18n/contract.md §5`;
    }
  }
  return null;
}

// Default catalog must itself be ICU-valid (brace balance + full compile).
for (const key of baseKeys) {
  const err = braceError(base[key]) || icuError(base[key], DEFAULT_LOCALE);
  if (err) problems.push(`${DEFAULT_LOCALE}: "${key}" — ${err}`);
  const dash = dashError(base[key]);
  if (dash) problems.push(`${DEFAULT_LOCALE}: "${key}" — ${dash}`);
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
    const dash = dashError(catalog[key]);
    if (dash) problems.push(`${locale}: "${key}" — ${dash}`);
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

/**
 * Every string/template literal inside an `aria-label={…}` expression container on
 * this line that is NOT a call argument.
 *
 * Bounded by BRACE MATCHING, not by end-of-line: `aria-label={t("close")}
 * className="focus-ring …"` must not report the className. Quotes inside the
 * expression are skipped while matching so an ICU brace in a message (`t("a {b}")`)
 * cannot close it early.
 *
 * "Call argument" is the allowance because that is exactly what a LOCALIZED name
 * looks like here — `t("someKey")`, `t("k", { n })`. A literal in any other
 * position (`x || "Rich text editor"`, `cond ? "A" : "B"`) is a name four locales
 * would read in English.
 */
function ariaLabelLiterals(line) {
  const found = [];
  for (let m = line.indexOf("aria-label={"); m !== -1; m = line.indexOf("aria-label={", m + 1)) {
    let depth = 0;
    let quote = "";
    for (let i = m + "aria-label=".length; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        // The character that OPENS this literal decides its role: `(` or `,` means it
        // sits in an argument list, anything else means it is being used as a value.
        const before = line.slice(0, i).replace(/\s+$/, "").slice(-1);
        if (before !== "(" && before !== ",") found.push(ch);
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 1) break;
        depth--;
      }
    }
  }
  return found;
}

let primitiveFileCount = 0;
for (const file of tsxFiles(PRIMITIVES_DIR)) {
  primitiveFileCount++;
  const lines = readFileSync(file, "utf8").split(LINE_BREAK);
  const rel = relative(REPO_ROOT, file).split("\\").join("/");
  lines.forEach((line, i) => {
    if (HARDCODED_ARIA.test(line) || ariaLabelLiterals(line).length > 0) {
      problems.push(
        `${rel}:${i + 1} — hardcoded aria-label in a shared primitive; ` +
          `route it through useTranslations() so all 4 locales get it`
      );
    }
  });
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

// A scoped scan whose scope silently evaporates is worse than no scan: renaming
// or removing one of these directories used to drop it from the sweep with the
// gate still printing OK. A path in the list that is not on disk is a problem to
// resolve deliberately (fix the path, or delete the entry), never a skip.
let sealedFileCount = 0;
for (const dir of SEALED_ATTR_DIRS) {
  if (!existsSync(dir)) {
    problems.push(
      `scripts/i18n-check.mjs — SEALED_ATTR_DIRS names ${relative(REPO_ROOT, dir).split("\\").join("/")}, which is not on disk; ` +
        `that directory is no longer being checked. Update the list in the same change that moved it.`
    );
    continue;
  }
  for (const file of tsxFiles(dir)) {
    sealedFileCount++;
    const lines = readFileSync(file, "utf8").split(LINE_BREAK);
    lines.forEach((line, i) => {
      const hit = line.match(HARDCODED_ATTR);
      if (hit) {
        problems.push(
          `${relative(REPO_ROOT, file).split("\\").join("/")}:${i + 1} — hardcoded ${hit[1]} on a public marketing page; ` +
            `route it through useTranslations() so all 4 locales get it`
        );
      }
    });
  }
}

// Every machine error code the server can return must have a localized message,
// or useErrorMessage() silently falls through to the caller's generic fallback and
// the specific reason is lost in all four locales. Two registries emit codes and
// both are pinned to the `errors` namespace:
//   STORE_ERRORS   — safe generics for store-backed 500s (the real error is logged, not sent)
//   REFUSAL_ERRORS — deliberate 4xx business rules, where the message IS the information
const apiResponseSrc = readFileSync(join(REPO_ROOT, "app", "_lib", "api-response.ts"), "utf8");
for (const registry of ["STORE_ERRORS", "REFUSAL_ERRORS"]) {
  const block = apiResponseSrc.match(new RegExp(`export const ${registry} = \\{([\\s\\S]*?)\\n\\} as const;`));
  if (!block) {
    problems.push(`app/_lib/api-response.ts — could not locate the ${registry} block (did its shape change?)`);
    continue;
  }
  const codes = [...block[1].matchAll(/^ {2}([A-Z_0-9]+):/gm)].map((m) => m[1]);
  if (!codes.length) {
    problems.push(`app/_lib/api-response.ts — ${registry} parsed to zero codes (did its shape change?)`);
    continue;
  }
  for (const code of codes) {
    if (!baseKeys.includes(`errors.${code}`)) {
      problems.push(
        `${registry}.${code} has no \`errors.${code}\` message in messages/${DEFAULT_LOCALE}.json — ` +
          `add it so the code resolves to real copy instead of a generic fallback`
      );
    }
  }
}

let uiFileCount = 0;
for (const dir of UI_DIRS) {
  const abs = join(REPO_ROOT, ...dir.split("/"));
  if (!existsSync(abs)) {
    problems.push(
      `scripts/i18n-check.mjs — UI_DIRS names ${dir}, which is not on disk; that directory is no longer ` +
        `being scanned for English API-error leaks. Update the list in the same change that moved it.`
    );
    continue;
  }
  for (const file of sourceFiles(abs)) {
    const rel = relative(REPO_ROOT, file).split("\\").join("/");
    if (ERROR_LEAK_ALLOW.has(rel)) continue;
    uiFileCount++;
    readFileSync(file, "utf8")
      .split(LINE_BREAK)
      .forEach((line, i) => {
        if (ENGLISH_ERROR_LEAK.test(line)) {
          problems.push(
            `${rel}:${i + 1} — shows the server's English \`error\` string; resolve the machine \`code\` ` +
              `instead via useErrorMessage() / resolveErrorMessage (app/_lib/use-error-message.ts)`
          );
        }
      });
  }
}

if (problems.length) {
  console.error(`[i18n-check] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `[i18n-check] OK — ${baseKeys.length} keys, ${files.length} locale(s) in parity; ` +
    `${primitiveFileCount} shared primitive(s) + ${sealedFileCount} marketing file(s) free of hardcoded attributes; ${uiFileCount} UI file(s) free of English API-error leaks.`
);
