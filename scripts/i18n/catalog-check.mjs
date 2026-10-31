// The catalog half of scripts/i18n-check.mjs: key parity, ICU syntax, placeholder
// parity and the no-dash house rule (docs/i18n/contract.md §5), run over every
// STRING in every catalog, at any depth.
//
// Why this is a module with fixtures (i18n/catalog-check.test.ts) rather than a
// block in the gate: until 2026-09-14 the gate flattened nested objects into dotted
// keys and stored an ARRAY as a single leaf value, and every content check opened
// with `if (typeof value !== "string") return`. Fourteen arrays holding 62 strings
// per locale (landing feature lists, legal bullet lists, the voice transcript) were
// therefore outside the em-dash ban, the ICU compile and placeholder parity at
// once. The contract said the dash rule was gated; the one banned em dash left in
// en.json sat inside one of those arrays; and the success line printed a KEY count
// that counted each array as one key, so a green run could not reveal the gap.
//
// So the walker below descends objects, arrays and objects inside arrays, and gives
// each string an address a finding can cite (`landing.voice.transcript[0]`,
// `a.rows[1].label`). Coverage is COUNTED, not claimed: a second, deliberately dumb
// recursion counts every string in the parsed catalog, and a walker that extracted
// fewer is a gate failure, because it means some rule ran on less than the catalog.

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

/**
 * Every string in a parsed catalog, addressed by key path plus array index, plus
 * every value that is neither a string nor a container, and every array's length
 * (for list parity across locales).
 */
export function stringUnits(catalog) {
  const units = new Map();
  const nonStrings = [];
  const arrays = new Map();
  const walk = (value, address) => {
    if (typeof value === "string") units.set(address, value);
    else if (Array.isArray(value)) {
      arrays.set(address, value.length);
      value.forEach((item, i) => walk(item, `${address}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, address ? `${address}.${key}` : key);
    } else nonStrings.push({ address, value });
  };
  walk(catalog, "");
  return { units, nonStrings, arrays };
}

/** The independent count the walker is held to. Kept dumb on purpose: no address
 *  building and no array branch (Object.values reads arrays and objects alike), so a
 *  shape the walker mishandles, or two keys that collide on one address, shows up as
 *  a difference instead of being reproduced by the check that should catch it. */
export function countStrings(value) {
  if (typeof value === "string") return 1;
  if (value && typeof value === "object") {
    let n = 0;
    for (const child of Object.values(value)) n += countStrings(child);
    return n;
  }
  return 0;
}

function icuError(value, locale) {
  if (!IntlMessageFormat) return null;
  try {
    new IntlMessageFormat(value, locale);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return `invalid ICU message — ${msg}`;
  }
}

/** The argument + rich-tag names a message references — used to assert en and a
 *  translation share the same variables/tags. AST-based when the parser is
 *  available (so plural/select branch LITERALS like `one {is}` are correctly NOT
 *  treated as placeholders, and rich tags `<b>` are compared); otherwise falls
 *  back to a `{name}` regex. */
function argNames(value) {
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
export function dashError(value) {
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

// ---- Control characters --------------------------------------------------------
// A C0 control character in catalog copy is never intended. The one that reached
// production was U+0001: a regex backreference written into a French string where a
// colon or semicolon belonged, 33 times in one file, invisible in an editor and passed
// by every other check here. It is REPORTED, not stripped: deleting it leaves a gap
// where the punctuation was, and the right mark is only recoverable from the default
// locale. Tab, LF and CR are legal in a message.
const CONTROL_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export function controlCharError(value) {
  const m = CONTROL_CHAR.exec(value);
  if (!m) return null;
  const hex = m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
  const ctx = JSON.stringify(value.slice(Math.max(0, m.index - 12), m.index + 13));
  return `control character U+${hex} in ${ctx} — a lost or mangled punctuation mark; restore it from the default locale`;
}

// ---- Carried literals ------------------------------------------------------------
// URLs, email addresses and multi-digit numbers in the default-locale copy must reach
// every translation by IDENTITY, not by count: a count passes a transposed digit and an
// edited host, which is how this class fails. Direction is source to target only: a
// single digit rendered as a word ("1" -> "un") and a spelled-out number rendered as
// digits ("thirty" -> "30") are legitimate, so only the source's literals are demanded.
// Placeholders are stripped first (they are the parity check's job), and a reserved
// example domain is exempt because a translation localises it on purpose
// (you@example.com -> vous@exemple.com). A key whose last segment ends in "Placeholder"
// is exempt for the same reason: it is an illustrative sample for an input
// (name@company.com, github.com/owner/repo) that every locale localises. Measured
// 2026-10-14 on this repo's catalogs: without that exemption 7 keys per locale fire,
// all samples; with it the shipped catalogs carry no literal drift.
const URL_LITERAL = /https?:\/\/[\w-]+(?:\.[\w-]+)+[^\s)"'<>]*/g;
const EMAIL_LITERAL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const NUMBER_LITERAL = /\d{2,}/g;
export function carriedLiterals(value) {
  const bare = value.replace(/\{[^{}]*\}/g, " ");
  const urls = bare.match(URL_LITERAL) ?? [];
  const rest = bare.replace(URL_LITERAL, " ");
  const emails = (rest.match(EMAIL_LITERAL) ?? []).filter((e) => !/@example\.[a-z]+$/i.test(e));
  const numbers = rest.replace(EMAIL_LITERAL, " ").match(NUMBER_LITERAL) ?? [];
  return [...urls.map((v) => ["URL", v]), ...emails.map((v) => ["email", v]), ...numbers.map((v) => ["number", v])];
}
// Literals are compared as TOKENS with multiplicity, not as substrings. Until
// 2026-10-31 this was `target.includes(literal)`, so "48" was carried by "480" (a
// number inside a longer number) and a literal the source states twice was carried
// by a target that states it once. Tokenising the target with the SAME extractor
// gives each side identical boundaries (a greedy digit run, a whole URL, a whole
// address), and the multiset comparison demands each literal as many times as the
// source carries it. Still source to target only: extra target literals are legal.
export function missingLiterals(baseValue, value) {
  const key = (kind, literal) => `${kind}\u0000${literal}`;
  const have = new Map();
  for (const [kind, literal] of carriedLiterals(value)) have.set(key(kind, literal), (have.get(key(kind, literal)) ?? 0) + 1);
  const need = new Map();
  for (const [kind, literal] of carriedLiterals(baseValue)) {
    const k = key(kind, literal);
    if (!need.has(k)) need.set(k, { kind, literal, need: 0, have: have.get(k) ?? 0 });
    need.get(k).need++;
  }
  return [...need.values()].filter((m) => m.have < m.need);
}
export function literalErrors(baseValue, value) {
  return missingLiterals(baseValue, value).map(
    ({ kind, literal, need, have }) =>
      `${kind} "${literal}" from the default locale is missing or altered` + (need > 1 ? ` (carried ${have} of ${need} times)` : "")
  );
}

// A message whose syntax does not parse is ONE defect. Brace balance is the cheap
// fast-fail for the ICU compile, so the compile does not also report it, and the
// placeholder and literal checks (which read a parse that does not exist) are skipped
// for that unit by the caller: see syntaxError().
export function syntaxError(value, locale) {
  return braceError(value) || icuError(value, locale);
}

function contentProblems(locale, address, value) {
  const out = [];
  const ctrl = controlCharError(value);
  if (ctrl) out.push(`${locale}: "${address}" — ${ctrl}`);
  const err = syntaxError(value, locale);
  if (err) out.push(`${locale}: "${address}" — ${err}`);
  const dash = dashError(value);
  if (dash) out.push(`${locale}: "${address}" — ${dash}`);
  return out;
}

/**
 * Run every catalog check over parsed catalogs.
 *
 * @param catalogs `[{ locale, data }]` — `data` is the parsed JSON of one catalog.
 * @param defaultLocale the locale every other catalog is held to.
 * @returns the problems, the default catalog's string addresses (the key set the
 *          gate's code/archetype lookups resolve against), and the coverage numbers
 *          the gate prints.
 */
export function checkCatalogs(catalogs, defaultLocale) {
  const problems = [];
  // Structured twin of the target-side problems that a SHARED SOURCE can cause:
  // a placeholder the translation lost or invented, a message that will not
  // compile, a key the locale lacks. Dash and orphan findings are excluded: they
  // are the translator's own punctuation or leftovers, not what a source forces.
  const targetFindings = [];
  const note = (locale, address, check) => targetFindings.push({ locale, address, check });
  const walked = new Map();
  let totalUnits = 0;
  let totalCounted = 0;

  for (const { locale, data } of catalogs) {
    const w = stringUnits(data);
    const counted = countStrings(data);
    walked.set(locale, w);
    totalUnits += w.units.size;
    totalCounted += counted;
    if (w.units.size === 0) {
      problems.push(`${locale}: the catalog yielded zero strings — having looked at nothing is not a clean result`);
    }
    if (w.units.size !== counted) {
      problems.push(
        `${locale}: the walker extracted ${w.units.size} string(s) but the catalog holds ${counted} — ` +
          `the difference would skip every content check (an address collision, or a shape the walker does not descend)`
      );
    }
    for (const { address, value } of w.nonStrings) {
      problems.push(`${locale}: "${address}" — ${value === null ? "null" : typeof value} value; a catalog value must be a string`);
    }
  }

  const base = walked.get(defaultLocale);
  if (!base) throw new Error(`checkCatalogs: no catalog for the default locale "${defaultLocale}"`);

  for (const [address, value] of base.units) problems.push(...contentProblems(defaultLocale, address, value));

  for (const { locale } of catalogs) {
    if (locale === defaultLocale) continue;
    const { units, arrays } = walked.get(locale);

    // List parity. A translated list with a different number of items is a
    // different list; say so once, instead of once per shifted item.
    const mismatched = [];
    for (const [address, length] of base.arrays) {
      const other = arrays.get(address);
      if (other !== undefined && other !== length) {
        mismatched.push(address);
        problems.push(`${locale}: "${address}" — list has ${other} item(s), ${defaultLocale} has ${length}; translated lists must match item for item`);
      }
    }
    const inMismatchedList = (address) => mismatched.some((a) => address.startsWith(`${a}[`));

    for (const [address, baseValue] of base.units) {
      if (!units.has(address)) {
        if (!inMismatchedList(address)) {
          problems.push(`${locale}: missing key "${address}" (present in ${defaultLocale})`);
          note(locale, address, "missing-key");
        }
        continue;
      }
      const value = units.get(address);
      problems.push(...contentProblems(locale, address, value));
      if (braceError(value) || icuError(value, locale)) note(locale, address, "icu-syntax");
      // Precondition: a unit that does not parse already has its one finding above.
      if (syntaxError(value, locale)) continue;
      const isSample = /Placeholder$/.test(address.split(".").pop().replace(/\[\d+\]$/, ""));
      for (const e of isSample ? [] : literalErrors(baseValue, value)) problems.push(`${locale}: "${address}" — ${e}`);
      const baseVars = argNames(baseValue);
      const localeVars = argNames(value);
      for (const v of baseVars) {
        if (!localeVars.has(v)) {
          problems.push(`${locale}: "${address}" — missing placeholder {${v}}`);
          note(locale, address, "placeholder-missing");
        }
      }
      for (const v of localeVars) {
        if (!baseVars.has(v)) {
          problems.push(`${locale}: "${address}" — unexpected placeholder {${v}} (not in ${defaultLocale})`);
          note(locale, address, "placeholder-unexpected");
        }
      }
    }
    for (const [address, value] of units) {
      if (base.units.has(address)) continue;
      // An orphan is still copy a reader might see; the house rule applies to it too.
      problems.push(...contentProblems(locale, address, value));
      if (!inMismatchedList(address)) problems.push(`${locale}: orphan key "${address}" (not in ${defaultLocale})`);
    }
  }

  let listStrings = 0;
  for (const address of base.units.keys()) if (address.includes("[")) listStrings++;

  return {
    problems,
    sourceSuspects: sourceSuspects(targetFindings),
    baseKeys: [...base.units.keys()],
    coverage: {
      locales: catalogs.length,
      defaultStrings: base.units.size,
      listStrings,
      lists: base.arrays.size,
      totalUnits,
      totalCounted
    }
  };
}

/**
 * Source defects from cross-language agreement: a source string whose targets fail
 * checks in TWO OR MORE locales is more likely a defect of the shared source (an
 * untyped placeholder, a fragment) than two translators slipping on one string.
 * Advisory: it ranks triage, it does not block and it does not replace the
 * per-locale findings. Every suspect cites each locale and the check that failed.
 * The floor is an absolute count of distinct failing locales.
 */
export function sourceSuspects(findings, floor = 2) {
  const byAddress = new Map();
  for (const f of findings) {
    if (!byAddress.has(f.address)) byAddress.set(f.address, new Map());
    const perLocale = byAddress.get(f.address);
    if (!perLocale.has(f.locale)) perLocale.set(f.locale, new Set());
    perLocale.get(f.locale).add(f.check);
  }
  const out = [];
  for (const [address, perLocale] of byAddress) {
    if (perLocale.size < floor) continue;
    out.push({
      address,
      locales: [...perLocale.keys()].sort(),
      failures: [...perLocale].map(([locale, checks]) => ({ locale, checks: [...checks].sort() }))
    });
  }
  return out.sort((a, b) => b.locales.length - a.locales.length || a.address.localeCompare(b.address));
}
