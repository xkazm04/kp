#!/usr/bin/env node
// ADR integrity gate for docs/architecture/decisions/.
//
// An ADR that names a file which no longer exists is worse than no ADR: it
// reads as current and sends the next agent to a path that moved. That is the
// exact drift class that made docs/ get reorganised (see docs/README.md), so
// the ADR set gets a machine check from day one rather than after the rot.
//
// What it verifies, per record:
//   - YAML front matter is present and carries id / title / status / date / sources
//   - `id` is a 4-digit string and matches the filename prefix; no duplicates
//   - `status` is in the vocabulary; `date` is ISO YYYY-MM-DD
//   - every path under `sources:` EXISTS on disk (the drift check)
//   - `supersedes` / `superseded-by` point at real ADRs and are reciprocal,
//     and a record with `superseded-by` set carries status `superseded`
//   - the index table in README.md lists every record exactly once, with the
//     same title and status as the record itself
//
// Run:  node scripts/docs/check-adrs.mjs [--json]
// Also: npm run docs:check   (this + the doc-sync diff check)
// Tests: node scripts/docs/__tests__/check-adrs.test.mjs

import fs from 'node:fs';
import path from 'node:path';

export const ADR_DIR = 'docs/architecture/decisions';
export const STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated'];
const REQUIRED_KEYS = ['id', 'title', 'status', 'date', 'sources'];

/**
 * Minimal YAML-subset front-matter parser. Deliberately NOT a YAML library:
 * the ADR front matter is a fixed, flat shape (scalars, inline lists, block
 * lists) and adding a dependency to scripts/ for it would be the wrong trade.
 * Anything outside that shape is a validation error, not something to guess at.
 *
 * Returns { data, error }.
 */
export function parseFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { data: null, error: 'no front matter (file must open with ---)' };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { data: null, error: 'front matter is never closed with ---' };

  const data = {};
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;

    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (!listKey) return { data: null, error: `list item with no key on line ${i + 1}` };
      data[listKey].push(unquote(item[1]));
      continue;
    }

    const kv = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) return { data: null, error: `unparsable front-matter line ${i + 1}: ${raw}` };
    const [, key, rest] = kv;
    const value = rest.trim();

    if (value === '') {
      // Block list follows (or an empty value — resolved after the loop).
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    if (value === 'null' || value === '~') data[key] = null;
    else if (value.startsWith('[')) data[key] = parseInlineList(value);
    else data[key] = unquote(value);
  }
  return { data, error: null };
}

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineList(value) {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map(unquote).filter(Boolean);
}

/** Rows of the README index table: `| [0001](file.md) | Title | status | date |`. */
export function parseIndexRows(readme) {
  const rows = [];
  for (const line of readme.split(/\r?\n/)) {
    const m = line.match(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/);
    if (!m) continue;
    rows.push({ id: m[1], file: m[2].trim(), title: m[3].trim(), status: m[4].trim(), date: m[5].trim() });
  }
  return rows;
}

function asList(value) {
  if (value === null || value === undefined || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Pure validation core.
 *
 * @param records  [{ file, text }]  — ADR filename (basename) + raw contents
 * @param readme   raw contents of the index README
 * @param exists   (repoRelativePath) => boolean
 * @returns { problems: string[], adrs: [...] }
 */
export function validate(records, readme, exists) {
  const problems = [];
  const adrs = [];

  for (const { file, text } of records) {
    const where = `${ADR_DIR}/${file}`;
    const { data, error } = parseFrontMatter(text);
    if (error) {
      problems.push(`${where}: ${error}`);
      continue;
    }

    for (const key of REQUIRED_KEYS) {
      if (data[key] === undefined) problems.push(`${where}: front matter is missing \`${key}\``);
    }

    const id = data.id === undefined || data.id === null ? '' : String(data.id);
    if (!/^\d{4}$/.test(id)) {
      problems.push(`${where}: id must be a 4-digit string (got ${JSON.stringify(data.id)})`);
    } else if (!file.startsWith(`${id}-`)) {
      problems.push(`${where}: filename must start with the id \`${id}-\``);
    }

    if (data.status !== undefined && !STATUSES.includes(data.status)) {
      problems.push(`${where}: status \`${data.status}\` is not one of ${STATUSES.join(' | ')}`);
    }

    if (data.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
      problems.push(`${where}: date must be ISO YYYY-MM-DD (got ${JSON.stringify(data.date)})`);
    }

    // The drift check: an ADR is only trustworthy while the files it claims to
    // govern are still there.
    for (const src of asList(data.sources)) {
      if (!exists(src)) {
        problems.push(
          `${where}: sources lists \`${src}\`, which does not exist — the decision moved or the ` +
            `path is stale. Update the record (or mark it superseded); do not delete the line.`,
        );
      }
    }
    if (data.sources !== undefined && asList(data.sources).length === 0) {
      problems.push(`${where}: sources is empty — name at least one file that enacts this decision`);
    }

    // `superseded-by:` with nothing after it parses as an empty block list.
    // Normalise it to null so an empty value never reads as "superseded by
    // something" (an empty array is truthy).
    const rawSupersededBy = data['superseded-by'];
    const supersededBy =
      rawSupersededBy === undefined || rawSupersededBy === null || rawSupersededBy === '' ||
      (Array.isArray(rawSupersededBy) && rawSupersededBy.length === 0)
        ? null
        : Array.isArray(rawSupersededBy)
          ? rawSupersededBy[0]
          : rawSupersededBy;
    if (supersededBy && data.status !== 'superseded') {
      problems.push(`${where}: superseded-by is set to ${supersededBy} but status is \`${data.status}\``);
    }

    adrs.push({
      file,
      id,
      title: data.title ?? '',
      status: data.status ?? '',
      date: data.date ?? '',
      supersedes: asList(data.supersedes),
      supersededBy,
    });
  }

  // Duplicate ids.
  const byId = new Map();
  for (const adr of adrs) {
    if (byId.has(adr.id)) problems.push(`duplicate ADR id ${adr.id}: ${byId.get(adr.id).file} and ${adr.file}`);
    else byId.set(adr.id, adr);
  }

  // Supersede links resolve and are reciprocal in both directions.
  for (const adr of adrs) {
    if (adr.supersededBy) {
      const target = byId.get(String(adr.supersededBy));
      if (!target) problems.push(`${adr.file}: superseded-by ${adr.supersededBy} is not an ADR here`);
      else if (!target.supersedes.includes(adr.id)) {
        problems.push(`${adr.file}: superseded-by ${target.id}, but ${target.file} does not list ${adr.id} in supersedes`);
      }
    }
    for (const sup of adr.supersedes) {
      const target = byId.get(String(sup));
      if (!target) problems.push(`${adr.file}: supersedes ${sup}, which is not an ADR here`);
      else if (String(target.supersededBy ?? '') !== adr.id) {
        problems.push(`${adr.file}: supersedes ${sup}, but ${target.file} does not name ${adr.id} in superseded-by`);
      }
    }
  }

  // Index completeness and agreement.
  const rows = parseIndexRows(readme);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const adr of adrs) {
    const row = rowById.get(adr.id);
    if (!row) {
      problems.push(`${ADR_DIR}/README.md: index has no row for ${adr.id} (${adr.file})`);
      continue;
    }
    if (row.file !== adr.file) problems.push(`${ADR_DIR}/README.md: row ${adr.id} links \`${row.file}\`, expected \`${adr.file}\``);
    if (row.title !== adr.title) problems.push(`${ADR_DIR}/README.md: row ${adr.id} title \`${row.title}\` != record title \`${adr.title}\``);
    if (row.status !== adr.status) problems.push(`${ADR_DIR}/README.md: row ${adr.id} status \`${row.status}\` != record status \`${adr.status}\``);
  }
  for (const row of rows) {
    if (!byId.has(row.id)) problems.push(`${ADR_DIR}/README.md: index row ${row.id} has no matching record file`);
  }

  return { problems, adrs };
}

function main(argv) {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = path.join(repoRoot, ADR_DIR);
  const json = argv.includes('--json');

  if (!fs.existsSync(dir)) {
    process.stderr.write(`check-adrs: ${ADR_DIR} does not exist.\n`);
    return 1;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();

  const records = files.map((file) => ({ file, text: fs.readFileSync(path.join(dir, file), 'utf8') }));
  const readmePath = path.join(dir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    process.stderr.write(`check-adrs: ${ADR_DIR}/README.md (the index) is missing.\n`);
    return 1;
  }
  const readme = fs.readFileSync(readmePath, 'utf8');

  const { problems, adrs } = validate(records, readme, (p) => fs.existsSync(path.join(repoRoot, p)));

  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, count: adrs.length, problems, adrs }, null, 2)}\n`);
    return problems.length === 0 ? 0 : 1;
  }

  if (problems.length === 0) {
    process.stdout.write(`check-adrs: ✓ ${adrs.length} decision record(s) valid; every \`sources:\` path exists.\n`);
    return 0;
  }

  process.stderr.write(`check-adrs: ✗ ${problems.length} problem(s) in ${ADR_DIR}:\n\n`);
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write(`\nSee ${ADR_DIR}/README.md for the record shape.\n`);
  return 1;
}

if (process.argv[1]?.endsWith('check-adrs.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
