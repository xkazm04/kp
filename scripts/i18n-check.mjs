#!/usr/bin/env node
// i18n catalog parity + sanity check — the CI gate that keeps translation gaps
// from shipping. For every non-default locale it asserts:
//   1. no key present in the default (en) catalog is MISSING,
//   2. no key exists that the default does NOT have (an orphan / typo),
//   3. every message has balanced ICU `{ }` braces and matching placeholder
//      names against the default (so `{count}` in en isn't `{pocet}` in cs),
//   4. every translated list has as many items as the default's.
// All four, and the §5 dash rule, run over every string at ANY depth, list items
// included, and the output counts the strings checked (scripts/i18n/catalog-check.mjs).
// Exits non-zero (failing CI / the i18n:check script) on any problem. The
// compile-time half of gap prevention is the next-intl Messages augmentation in
// global.d.ts (unknown keys are TS errors); this is the cross-locale half.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalogs } from "./i18n/catalog-check.mjs";
import { copyDefaults } from "./i18n/primitive-copy-defaults.mjs";

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
  return JSON.parse(text);
}

const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
const defaultFile = `${DEFAULT_LOCALE}.json`;
if (!files.includes(defaultFile)) {
  console.error(`[i18n-check] missing default catalog messages/${defaultFile}`);
  process.exit(1);
}

const problems = [];
// Default catalog first: every other locale is held to it.
const catalogs = [defaultFile, ...files.filter((f) => f !== defaultFile)].map((file) => ({
  locale: file.replace(/\.json$/, ""),
  data: loadCatalog(file)
}));
// Key parity, list parity, ICU syntax, placeholder parity and the §5 dash rule, over
// every string at any depth. See scripts/i18n/catalog-check.mjs for why "any depth"
// had to be said out loud.
const catalogResult = checkCatalogs(catalogs, DEFAULT_LOCALE);
problems.push(...catalogResult.problems);
// The default catalog's string addresses. The error-code and archetype lookups below
// resolve plain object paths, so a list-item address (`a.b[0]`) never matches one.
const baseKeys = catalogResult.baseKeys;

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
  // The third face of the same blind spot: English arriving as a PROP DEFAULT.
  // Neither JSX check above can see `placeholder = "Select…"` in the destructure,
  // and a default is exactly the value every caller that passes nothing renders —
  // Select shipped four of them, two with zero overriding callers. See
  // scripts/i18n/primitive-copy-defaults.mjs for why the rule is "starts with a
  // capital letter" and nothing wider.
  for (const finding of copyDefaults(lines.join("\n"))) {
    problems.push(
      `${rel}:${finding.line} — English copy as a prop default in a shared primitive ` +
        `(${finding.prop} = "${finding.value}"); resolve it through useTranslations() inside the ` +
        `component so all 4 locales get it, and keep the prop as an override`
    );
  }
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

// Every machine error code the app can put on the wire must have a localized
// message, or useErrorMessage()/resolveErrorMessage silently falls through to the
// caller's generic fallback and the specific reason is lost in all four locales.
//
// Until wave 37 this check saw ONLY the two central registries in api-response.ts,
// so the twenty-odd codes declared anywhere else resolved by luck: deleting one of
// their four catalog entries produced a green build and a generic message. Codes
// reach the wire in three shapes and all three are swept now:
//
//   1. CENTRAL registries — STORE_ERRORS (safe generics for store-backed 500s, the
//      real error is logged not sent) and REFUSAL_ERRORS (deliberate 4xx business
//      rules, where the message IS the information), both in api-response.ts.
//   2. SATELLITE registries — a vocabulary deliberately declared away from
//      api-response.ts (a CLIENT-origin transport code no route handler can ever
//      return; a validator's own union type) and therefore not written as a
//      `code:` literal. Listed in SATELLITE_ERROR_SOURCES because a declaration
//      shape cannot be guessed; each entry fails loudly if its file moves or its
//      shape changes, on the SEALED_ATTR_DIRS precedent — a scan whose scope
//      silently evaporates is worse than no scan.
//   3. INLINE codes — `code: "SOMETHING"` written at the emit site in a route
//      handler. Swept out of the whole app tree, which is the half that makes this
//      gate SELF-EXTENDING: a new route cannot add an unlocalized code without
//      also adding its copy, and no manifest edit is needed to notice it.
//
// A code counts as localized when it resolves under any of ERROR_NAMESPACES. Nearly
// all live in the app-wide `errors` namespace; the GitHub deep-dive keeps its codes
// in its own surface namespace on purpose (app/_lib/use-github-error.ts). Adding a
// namespace here widens what counts as localized — a deliberate act, not a workaround.
const ERROR_NAMESPACES = ["errors", "results.github.errors"];
const SATELLITE_ERROR_SOURCES = [
  {
    // `export const VOICE_TRANSPORT_ERRORS = { VOICE_TRANSPORT_NETWORK: "…", … } as const;`
    // Client-origin: the browser transport classifies its OWN failure, so these can
    // never appear in the server's store/refusal vocabulary. See the file's header.
    file: "app/_components/voice/transport/transport-error.ts",
    declaration: "VOICE_TRANSPORT_ERRORS",
    codes: (src) => {
      const block = src.match(/export const VOICE_TRANSPORT_ERRORS = \{([\s\S]*?)\n\} as const;/);
      return block ? [...block[1].matchAll(/^ {2}([A-Z_0-9]+):/gm)].map((m) => m[1]) : null;
    }
  },
  {
    // Client-origin: the browser classifies its OWN environment before /connect,
    // so these can never appear in the server's store/refusal vocabulary.
    file: "app/_lib/voice/preflight.ts",
    declaration: "VOICE_PREFLIGHT_ERRORS",
    codes: (src) => {
      const block = src.match(/export const VOICE_PREFLIGHT_ERRORS = \{([\s\S]*?)\n\} as const;/);
      return block ? [...block[1].matchAll(/^ {2}([A-Z_0-9]+):/gm)].map((m) => m[1]) : null;
    }
  },
  {
    // `export type JdFieldsErrorCode = "JD_FIELDS_REQUIRED" | …;` — a union, not an
    // object: validateJdFields returns the code beside its canonical-English `error`.
    file: "app/_lib/jd-limits.ts",
    declaration: "JdFieldsErrorCode",
    codes: (src) => {
      const block = src.match(/export type JdFieldsErrorCode =([^;]*);/);
      return block ? [...block[1].matchAll(/"([A-Z_0-9]+)"/g)].map((m) => m[1]) : null;
    }
  },
  {
    // A single exported constant, shared by the pairing route and its client poller.
    file: "app/_lib/agent-hire/pairing.ts",
    declaration: "PAIR_NO_SECRET_CODE",
    codes: (src) => {
      const hit = src.match(/export const PAIR_NO_SECRET_CODE = "([A-Z_0-9]+)";/);
      return hit ? [hit[1]] : null;
    }
  }
];

/** Where a code is localized, or null when no declared namespace carries it. */
function errorNamespaceFor(code) {
  return ERROR_NAMESPACES.find((ns) => baseKeys.includes(`${ns}.${code}`)) ?? null;
}
function requireLocalizedCode(code, origin) {
  if (errorNamespaceFor(code)) return;
  problems.push(
    `${origin} emits the error code \`${code}\`, which has no message in messages/${DEFAULT_LOCALE}.json ` +
      `under any of ${ERROR_NAMESPACES.map((ns) => `\`${ns}\``).join(" / ")} — add it (in all 4 catalogs) so the ` +
      `code resolves to real copy instead of a generic fallback`
  );
}

// 1. The central registries.
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
  for (const code of codes) requireLocalizedCode(code, `${registry} (app/_lib/api-response.ts)`);
}

// 2. The satellite registries.
let satelliteCodeCount = 0;
for (const source of SATELLITE_ERROR_SOURCES) {
  const abs = join(REPO_ROOT, ...source.file.split("/"));
  if (!existsSync(abs)) {
    problems.push(
      `scripts/i18n-check.mjs — SATELLITE_ERROR_SOURCES names ${source.file}, which is not on disk; ` +
        `its error codes are no longer being checked. Update the list in the same change that moved it.`
    );
    continue;
  }
  const codes = source.codes(readFileSync(abs, "utf8"));
  if (!codes || !codes.length) {
    problems.push(
      `${source.file} — could not read any error code out of ${source.declaration} (did its shape change?). ` +
        `Fix the extractor in scripts/i18n-check.mjs rather than leaving the registry unchecked.`
    );
    continue;
  }
  for (const code of codes) {
    satelliteCodeCount++;
    requireLocalizedCode(code, `${source.declaration} (${source.file})`);
  }
}

// 3. Codes written inline at the emit site. sourceFiles() already skips *.test.* —
// test files mint deliberately unknown codes ("NOT_IN_CATALOG") to prove the
// resolver's fallback, and pinning those would invert the test.
let inlineCodeCount = 0;
const seenInlineCodes = new Set();
for (const file of sourceFiles(join(REPO_ROOT, "app"))) {
  const rel = relative(REPO_ROOT, file).split("\\").join("/");
  for (const hit of readFileSync(file, "utf8").matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]{3,})"/g)) {
    const code = hit[1];
    inlineCodeCount++;
    if (seenInlineCodes.has(code)) continue;
    seenInlineCodes.add(code);
    requireLocalizedCode(code, rel);
  }
}

// The archetype vocabulary is the same contract in a different namespace. Wave 37
// deleted BOTH raw-English exports the recruiter surfaces rendered — ARCHETYPE_BADGE
// (two candidate cards) and ARCHETYPE_LABEL's use in the analysis banner — so every
// archetype is now shown through useEnumLabel, which falls back to labelize(id) for a
// missing entry: English, silently, in all four locales.
//
// TWO label sets, because the registry always had two columns and they are not
// interchangeable. Both are keyed by the same ids:
//   enums.archetype.<id>     — the compact BADGE form, for dense recruiter lists
//                              ("Student", "Switcher")
//   enums.archetypeLong.<id> — the full label, for a surface with room for it
//                              ("Student / early-career")
// The shared registry is the id vocabulary for BOTH languages, so a new archetype
// must arrive with eight entries. `unrouted` is not in the registry: it is the
// fail-closed display key archetypeDisplayKey stamps for anything unrecognized, and
// it is exactly the value a reader sees when routing failed, so it is not optional.
const ARCHETYPE_LABEL_NAMESPACES = [
  ["enums.archetype", "the compact badge form the recruiter lists render"],
  ["enums.archetypeLong", "the full label the analysis banner renders"]
];
const archetypeRegistryPath = join(REPO_ROOT, "pipeline", "jobfit", "archetypes.json");
if (!existsSync(archetypeRegistryPath)) {
  problems.push(
    `scripts/i18n-check.mjs — pipeline/jobfit/archetypes.json is not on disk, so archetype display labels ` +
      `are no longer being checked. Update the path in the same change that moved it.`
  );
} else {
  const registryIds = JSON.parse(readFileSync(archetypeRegistryPath, "utf8")).archetypes.map((a) => a.id);
  if (!registryIds.length) {
    problems.push(`pipeline/jobfit/archetypes.json parsed to zero archetypes (did its shape change?)`);
  }
  for (const id of [...registryIds, "unrouted"]) {
    for (const [ns, what] of ARCHETYPE_LABEL_NAMESPACES) {
      if (!baseKeys.includes(`${ns}.${id}`)) {
        problems.push(
          `archetype \`${id}\` has no \`${ns}.${id}\` label in messages/${DEFAULT_LOCALE}.json (${what}) — ` +
            `add it (in all 4 catalogs) so the surface shows a localized label instead of labelize("${id}")`
        );
      }
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

// Coverage is counted, not claimed: the line states how many STRINGS the catalog
// checks read, beside the independent count they are held to (a difference is
// already a problem above). It used to print a key count, which counted a list as
// one key and so could not reveal that the list's items were never checked.
const { coverage } = catalogResult;
const coverageLine =
  `${coverage.defaultStrings} strings per locale checked (${coverage.listStrings} of them inside ${coverage.lists} list(s)); ` +
  `${coverage.totalUnits} across ${coverage.locales} locale(s), independent string count ${coverage.totalCounted}`;

if (problems.length) {
  console.error(`[i18n-check] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`[i18n-check] catalog coverage: ${coverageLine}`);
  process.exit(1);
}

console.log(
  `[i18n-check] OK — ${coverageLine}; ${files.length} locale(s) in parity; ` +
    `${primitiveFileCount} shared primitive(s) + ${sealedFileCount} marketing file(s) free of hardcoded attributes; ` +
    `${uiFileCount} UI file(s) free of English API-error leaks; ` +
    `${satelliteCodeCount} satellite + ${seenInlineCodes.size} inline error code(s) localized (${inlineCodeCount} emit site(s)).`
);
