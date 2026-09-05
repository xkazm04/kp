#!/usr/bin/env node
// Blank the parts of a source line that are PROSE or DATA, so a regex that is
// looking for code stops matching a description of code.
//
// WHY THIS EXISTS. The constitution lens reads added diff lines with regexes.
// On 2026-09-05 the tenancy rule fired on this line in
// app/_lib/ats/connections-store.ts:
//
//     // Already present (the CREATE TABLE above just made it, or an earlier
//
// …a comment inside a `catch` explaining a migration, in a commit that creates
// no table at all. The push was waived with a `Gate-exemption:` trailer, which
// is the worst possible outcome for a gate: it taught the author that the way
// past this rule is a sentence rather than a fix, and the waiver downgraded
// every other finding in the range with it.
//
// THE ALGORITHM IS NOT NEW. `app/api/error-response-contract.test.ts` has masked
// comments and string contents this way since it was written ("this codebase
// documents its own past leaks in prose, so a scan that reads comments reports
// the documentation as the defect"). This module is a deliberate COPY of that
// masker, in .mjs, because scripts/review/ is dependency-free node that runs in
// CI jobs with no `npm ci` and cannot import a TypeScript test. The two are
// small, pure and separately tested; if you change one, read the other.
//
// TWO MASKS, NOT ONE — and picking the wrong one silently deletes a rule:
//
//   codeOnly()         comments AND string contents blanked. For rules that look
//                      for CODE: `it.skip(`, `.only(`.
//   withoutComments()  comments blanked, strings KEPT. For rules whose subject
//                      lives inside a string — `CREATE TABLE` is nearly always
//                      inside a template literal or an exec("…").
//
// Neither is right for the `suppression` rule: an `eslint-disable` IS a comment,
// so masking comments would remove the rule rather than sharpen it.
//
// LINE MODE (`{ line: true }`, the default for diff work) adds what a
// single-line reader needs and a whole-file reader must not have: a line whose
// first non-space character is `*` or `*/` is a block-comment continuation, and
// an unterminated `/*` or quote runs to the end of the line.

import path from 'node:path';

/** Extensions whose line comment is `#`. `#` is NOT a comment in JS/TS. */
const HASH_LANGS = new Set(['.py', '.pyi', '.yml', '.yaml', '.toml', '.sh', '.bash', '.rb', '.cfg', '.ini']);
/** Extensions whose line comment is `--`. */
const DASH_LANGS = new Set(['.sql']);

/**
 * Which comment syntaxes a path uses. Unknown extensions get the C-family set:
 * over-masking a comment is a missed finding on one line, while under-masking is
 * the false positive this module exists to stop, and the caller always has the
 * unmasked text as well.
 */
export function commentSyntaxFor(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  return {
    slashes: !HASH_LANGS.has(ext) && !DASH_LANGS.has(ext),
    hash: HASH_LANGS.has(ext),
    dashes: DASH_LANGS.has(ext),
  };
}

/**
 * A byte mask over `src`: 1 where the character is comment text or string
 * content, 0 where it is code.
 *
 * @param src   the source text (one line, in line mode)
 * @param opts  { strings=true, comments=true, line=true, syntax={slashes,hash,dashes} }
 */
export function maskOf(src, opts = {}) {
  const {
    strings = true,
    comments = true,
    line = true,
    syntax = { slashes: true, hash: false, dashes: false },
  } = opts;
  const mask = new Uint8Array(src.length);

  if (comments && line) {
    // A continuation line of a `/* … */` block: ` * the CREATE TABLE above`.
    const trimmed = src.trimStart();
    if (trimmed.startsWith('*')) {
      mask.fill(1);
      return mask;
    }
  }

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (comments && syntax.slashes && c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (comments && syntax.slashes && c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i);
      const end = close === -1 ? src.length : close + 2;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (comments && syntax.hash && c === '#') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (comments && syntax.dashes && c === '-' && src[i + 1] === '-') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      mask.fill(1, i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // Consumed whether or not it is masked: a `#` or `//` INSIDE a string is
      // not a comment, so `withoutComments` has to walk the string to skip it.
      const q = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        j += 1;
      }
      if (strings) mask.fill(1, i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return mask;
}

function blank(src, mask) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) out += mask[i] ? ' ' : src[i];
  return out;
}

/** Comments and string CONTENTS blanked — the regex sees code only. */
export function codeOnly(src, opts = {}) {
  return blank(src, maskOf(src, { ...opts, strings: true, comments: true }));
}

/** Comments blanked, strings kept — for a rule whose subject lives in a string. */
export function withoutComments(src, opts = {}) {
  return blank(src, maskOf(src, { ...opts, strings: false, comments: true }));
}

/** `codeOnly` for one diff line of a known file. */
export const codeOnlyLine = (text, filePath) =>
  codeOnly(text, { line: true, syntax: commentSyntaxFor(filePath) });

/** `withoutComments` for one diff line of a known file. */
export const withoutCommentsLine = (text, filePath) =>
  withoutComments(text, { line: true, syntax: commentSyntaxFor(filePath) });
