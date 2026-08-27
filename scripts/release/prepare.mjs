#!/usr/bin/env node
// Cut a release, or verify that the last one is still coherent.
//
//   node scripts/release/prepare.mjs --check              # CI: are the versions in sync?
//   node scripts/release/prepare.mjs --version 0.2.0      # bump + cut a CHANGELOG section
//   node scripts/release/prepare.mjs --version 0.2.0 --dry-run
//
// WHY: green CI did not lead anywhere. Nothing turned a passing commit into a
// versioned artifact, and a self-hoster had no boundary to pin to — the honest
// answer to "which version am I running?" was a git SHA, and the honest answer
// to "what changed?" was `git log`. This script owns the three places a version
// lives, so they cannot drift:
//
//   package.json          "version"
//   deploy/helm/kp/Chart.yaml   appVersion  (the image tag the chart defaults to)
//   CHANGELOG.md          a `## [x.y.z] - date` section
//
// `--check` runs in CI on every push. It does NOT require a release to have
// happened; it requires that the release which HAS happened is still described.
//
// The commit history is ~90% conventional-prefixed, which is what makes the
// section cut worth automating. Commits it cannot classify are not dropped —
// they land under "Other" so a release note is never quietly incomplete.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PKG = 'package.json';
const CHART = 'deploy/helm/kp/Chart.yaml';
const CHANGELOG = 'CHANGELOG.md';

// Conventional-commit type -> Keep-a-Changelog section. Order here is the order
// they appear in a release note: what a reader needs first, first.
export const SECTIONS = [
  ['Breaking changes', []],
  ['Security', ['security']],
  ['Added', ['feat']],
  ['Fixed', ['fix']],
  ['Performance', ['perf']],
  ['Changed', ['refactor', 'style']],
  ['Documentation', ['docs']],
  ['Internal', ['chore', 'test', 'ci', 'build']],
  ['Other', []],
];

const TYPE_TO_SECTION = new Map();
for (const [section, types] of SECTIONS) for (const t of types) TYPE_TO_SECTION.set(t, section);

/** Classify one commit subject. Unrecognised subjects go to "Other", never away. */
export function classify(subject) {
  const m = subject.match(/^([a-z]+)(\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m) return { section: 'Other', scope: null, text: subject.trim(), breaking: false };
  const [, type, , scope, bang, text] = m;
  const breaking = bang === '!';
  return {
    section: breaking ? 'Breaking changes' : (TYPE_TO_SECTION.get(type) ?? 'Other'),
    scope: scope || null,
    text: text.trim(),
    breaking,
  };
}

/** Render one CHANGELOG section from classified commits. */
export function renderSection(version, date, subjects, { includeInternal = false } = {}) {
  const entries = subjects.map(classify);
  const lines = [`## [${version}] - ${date}`, ''];
  let wrote = false;
  for (const [section] of SECTIONS) {
    if (section === 'Internal' && !includeInternal) continue;
    const rows = entries.filter((e) => e.section === section);
    if (!rows.length) continue;
    wrote = true;
    lines.push(`### ${section}`, '');
    for (const r of rows) lines.push(`- ${r.scope ? `**${r.scope}:** ` : ''}${r.text}`);
    lines.push('');
  }
  if (!wrote) lines.push('_No user-visible change in this release._', '');
  return lines.join('\n');
}

export function readVersionFromPackage(text) {
  return JSON.parse(text).version ?? null;
}

/** Chart.yaml is read with two anchored regexes rather than a YAML parser: the
 *  file is hand-maintained and heavily commented, and a round-trip through a
 *  parser would reformat it. */
export function readChartVersions(text) {
  return {
    version: text.match(/^version:\s*["']?([^\s"']+)["']?\s*$/m)?.[1] ?? null,
    appVersion: text.match(/^appVersion:\s*["']?([^\s"']+)["']?\s*$/m)?.[1] ?? null,
  };
}

export function setChartAppVersion(text, version) {
  return text.replace(/^(appVersion:\s*)["']?[^\s"']+["']?\s*$/m, `$1"${version}"`);
}

export function changelogHasVersion(text, version) {
  return new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text);
}

/**
 * The invariant `--check` enforces. Pure, so it is directly testable.
 * @returns string[] problems (empty = coherent)
 */
export function checkCoherence({ pkgVersion, chart, changelog }) {
  const problems = [];
  if (!pkgVersion) problems.push(`${PKG}: no "version" field`);
  if (!chart.appVersion) problems.push(`${CHART}: no appVersion`);
  if (pkgVersion && chart.appVersion && pkgVersion !== chart.appVersion) {
    problems.push(
      `version drift: ${PKG} says ${pkgVersion}, ${CHART} appVersion says ${chart.appVersion}. ` +
        `The chart's appVersion IS the image tag an operator gets by default — they must match.`,
    );
  }
  if (pkgVersion && !changelogHasVersion(changelog, pkgVersion)) {
    problems.push(
      `${CHANGELOG} has no "## [${pkgVersion}]" section. The current version has no release ` +
        `notes, so an operator deciding whether to upgrade has only git log.`,
    );
  }
  return problems;
}

// --- git helpers (not pure; not covered by fixtures) ------------------------

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function lastTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim() || null;
  } catch {
    return null;
  }
}

function subjectsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  return git(['log', '--no-merges', '--format=%s', range]).split('\n').map((s) => s.trim()).filter(Boolean);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}
function write(rel, text) {
  fs.writeFileSync(path.join(REPO_ROOT, rel), text, 'utf8');
}

export function parseArgs(argv) {
  const out = { check: false, version: null, dryRun: false, includeInternal: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--version') out.version = argv[++i];
    else if (argv[i] === '--date') out.date = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--include-internal') out.includeInternal = true;
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);

  if (args.check || !args.version) {
    const problems = checkCoherence({
      pkgVersion: readVersionFromPackage(read(PKG)),
      chart: readChartVersions(read(CHART)),
      changelog: read(CHANGELOG),
    });
    if (!problems.length) {
      process.stdout.write('release:check ✓ package.json, Chart.yaml appVersion and CHANGELOG agree.\n');
      return 0;
    }
    process.stderr.write(`release:check ✗ ${problems.length} problem(s):\n\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    process.stderr.write('\nSee docs/architecture/releases.md.\n');
    return 1;
  }

  const version = String(args.version).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    process.stderr.write(`release: "${version}" is not a semver version.\n`);
    return 1;
  }
  // The date is an ARGUMENT, defaulted from the system clock only here, so the
  // rendering functions above stay pure and testable.
  const date = args.date ?? new Date().toISOString().slice(0, 10);

  const tag = lastTag();
  const subjects = subjectsSince(tag);
  const section = renderSection(version, date, subjects, { includeInternal: args.includeInternal });

  const changelog = read(CHANGELOG);
  if (changelogHasVersion(changelog, version)) {
    process.stderr.write(`release: CHANGELOG already has a [${version}] section.\n`);
    return 1;
  }
  const marker = '<!-- next-release -->';
  if (!changelog.includes(marker)) {
    process.stderr.write(`release: ${CHANGELOG} is missing the ${marker} marker.\n`);
    return 1;
  }
  const nextChangelog = changelog.replace(marker, `${marker}\n\n${section.trimEnd()}`);

  const pkgText = read(PKG);
  const nextPkg = pkgText.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  const chartText = read(CHART);
  const nextChart = setChartAppVersion(chartText, version);

  if (args.dryRun) {
    process.stdout.write(
      `release: DRY RUN for ${version} (${subjects.length} commit(s) since ${tag ?? 'the beginning'})\n\n${section}\n`,
    );
    return 0;
  }

  write(CHANGELOG, nextChangelog);
  write(PKG, nextPkg);
  write(CHART, nextChart);
  process.stdout.write(
    `release: prepared ${version} from ${subjects.length} commit(s) since ${tag ?? 'the beginning'}.\n` +
      `  updated ${PKG}, ${CHART}, ${CHANGELOG}\n\n` +
      `Next: review the section, commit, then tag:\n` +
      `  git tag -a v${version} -m "v${version}" && git push origin v${version}\n` +
      `The tag is what triggers .github/workflows/release.yml.\n`,
  );
  return 0;
}

if (process.argv[1]?.endsWith('prepare.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
