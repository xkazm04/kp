#!/usr/bin/env node
// Fixtures for the comment/string masker. No deps — run with:
//   node scripts/review/__tests__/source-mask.test.mjs
//
// Every case is a line that really appeared in this repository, because the
// failure this module exists to prevent is a rule firing on a description of
// the thing it forbids.
import assert from 'node:assert/strict';
import { codeOnlyLine, commentSyntaxFor, maskOf, withoutCommentsLine } from '../source-mask.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

check('a // comment is blanked, the code before it is not', () => {
  const line = 'const x = 1; // it.skip( is fine in prose';
  assert.equal(codeOnlyLine(line, 'a.ts').trimEnd(), 'const x = 1;');
});

// The line that actually fired the tenancy rule (app/_lib/ats/connections-store.ts:99).
check('the comment that fired the tenancy rule masks to nothing', () => {
  const line = '    // Already present (the CREATE TABLE above just made it, or an earlier boot did) —';
  assert.ok(!/CREATE\s+TABLE/i.test(withoutCommentsLine(line, 'app/_lib/ats/connections-store.ts')));
});

check('a real CREATE TABLE inside a template literal survives', () => {
  const line = '  d.exec(`CREATE TABLE IF NOT EXISTS ats_connections (`);';
  assert.match(withoutCommentsLine(line, 'app/_lib/db/core.ts'), /CREATE TABLE/);
});

check('a block-comment continuation line is all prose', () => {
  const line = ' * so the CREATE TABLE below is the one that matters';
  assert.equal(withoutCommentsLine(line, 'app/a.ts').trim(), '');
});

check('an unterminated /* runs to the end of the line', () => {
  const line = 'x(); /* CREATE TABLE widgets';
  assert.equal(withoutCommentsLine(line, 'app/a.ts').trimEnd(), 'x();');
});

check('# is a comment in Python and NOT in TypeScript', () => {
  const py = 'value = 1  # @unittest.skip lives here in prose';
  assert.equal(codeOnlyLine(py, 'pipeline/jobfit/tests/test_x.py').trimEnd(), 'value = 1');
  const ts = 'class A { #count = 1; }';
  assert.match(codeOnlyLine(ts, 'app/a.ts'), /#count/);
  assert.deepEqual(commentSyntaxFor('a.py'), { slashes: false, hash: true, dashes: false });
  assert.deepEqual(commentSyntaxFor('a.ts'), { slashes: true, hash: false, dashes: false });
});

check('a # inside a string is not a comment', () => {
  const line = 'label = "#1 pick"  # a real comment';
  assert.match(withoutCommentsLine(line, 'x.py'), /#1 pick/);
  assert.ok(!withoutCommentsLine(line, 'x.py').includes('a real comment'));
});

check('codeOnly blanks string CONTENTS, withoutComments keeps them', () => {
  const line = 'const s = "describe.only(";';
  assert.ok(!/describe\.only\(/.test(codeOnlyLine(line, 'a.ts')));
  assert.match(withoutCommentsLine(line, 'a.ts'), /describe\.only\(/);
});

check('an escaped quote does not end the string early', () => {
  const line = 'const s = "a \\" it.skip(" ;';
  assert.ok(!/it\.skip\(/.test(codeOnlyLine(line, 'a.ts')));
});

check('a -- comment is only a comment in SQL', () => {
  assert.equal(withoutCommentsLine('SELECT 1; -- CREATE TABLE x', 'edge/schema.sql').trimEnd(), 'SELECT 1;');
  assert.match(withoutCommentsLine('const n = a -- b;', 'a.ts'), /a -- b/);
});

check('the mask is positional: length is preserved so line offsets survive', () => {
  const line = 'a(); // b';
  assert.equal(codeOnlyLine(line, 'a.ts').length, line.length);
  assert.equal(maskOf(line, { syntax: commentSyntaxFor('a.ts') }).length, line.length);
});

console.log(`\n${passed} checks passed.`);
