#!/usr/bin/env node
// The bill of materials for a released image.
//
// THE GAP THIS CLOSES: releases are signed and attested, so an operator can
// prove `ghcr.io/xkazm04/kp:0.1.0` came from this repository at a given commit.
// They could not find out what is INSIDE it. When the next advisory lands
// ("pypdf < 5.5", "a transitive of @sentry/nextjs"), the only honest answer was
// "pull the image and go look" — and an agent asked whether a running
// deployment is affected had nothing to read at all. This emits a CycloneDX 1.5
// document listing both halves of the runtime, attached to every GitHub Release.
//
//   node scripts/release/sbom.mjs --out dist/sbom/kp-0.1.0.cdx.json \
//     --version 0.1.0 --commit "$GITHUB_SHA" --image ghcr.io/xkazm04/kp:0.1.0
//   npm run sbom                       # writes dist/sbom/kp-<package version>.cdx.json
//
// WHY HAND-ROLLED RATHER THAN A SCANNER: the two inputs are already exact and
// already in the tree — `package-lock.json` resolves every npm version with its
// integrity hash, and `pip list` in the environment the image is built from
// resolves the Python side including transitives. A scanner would add a
// download, a pin to maintain and a second thing to trust, to read the same two
// files. Everything here is dependency-free node:* and covered by fixtures.
//
// WHAT IT COVERS, STATED HONESTLY (also recorded in the document's properties):
//   npm     the lockfile's PRODUCTION closure — `dev: true` entries excluded.
//           The image ships Next's traced subset of that, so this is a superset:
//           a package absent here is definitely absent from the image.
//   python  the resolved environment (`pip list`), which is what the image's
//           /opt/venv is built from — direct pins AND their transitives.
//
// EXIT CODES: 0 wrote a usable document · 1 refused to write one (a bill of
// materials that quietly lists nothing is worse than no bill of materials).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
export const SPEC_VERSION = '1.5';

// Floors, not exact counts: the failure this guards is an empty or half-read
// document shipping as if it were complete. This tree resolves hundreds of npm
// packages and a dozen-plus Python ones; anything near zero means the input was
// missing, not that the tree shrank.
export const MIN_NPM_COMPONENTS = 20;
export const MIN_PYTHON_COMPONENTS = 5;

/** purl for an npm package. A scoped name's `@` is percent-encoded, per the spec. */
export function purlNpm(name, version) {
  const at = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${at}@${version}`;
}

export function purlPypi(name, version) {
  return `pkg:pypi/${name.toLowerCase()}@${version}`;
}

/** `sha512-<base64>` (npm integrity) -> a CycloneDX hash entry, or null. */
export function hashesFromIntegrity(integrity) {
  if (typeof integrity !== 'string') return undefined;
  const out = [];
  for (const token of integrity.split(/\s+/).filter(Boolean)) {
    const [alg, b64] = token.split('-');
    const cdxAlg = { sha512: 'SHA-512', sha256: 'SHA-256', sha1: 'SHA-1' }[alg];
    if (!cdxAlg || !b64) continue;
    out.push({ alg: cdxAlg, content: Buffer.from(b64, 'base64').toString('hex') });
  }
  return out.length ? out : undefined;
}

function licenses(license) {
  const values = Array.isArray(license) ? license : license ? [license] : [];
  const out = values
    .filter((l) => typeof l === 'string' && l.trim())
    // An SPDX expression ("MIT OR Apache-2.0") is not an id; record it as a name
    // rather than asserting an id the consumer would fail to resolve.
    .map((l) => (/[\s()]/.test(l) ? { license: { name: l } } : { license: { id: l } }));
  return out.length ? out : undefined;
}

/**
 * Components from a parsed package-lock.json (lockfileVersion 2 or 3).
 * @returns component[] sorted by purl, deduplicated
 */
export function componentsFromLockfile(lock, { includeDev = false } = {}) {
  const packages = lock?.packages ?? {};
  const byPurl = new Map();

  for (const [key, entry] of Object.entries(packages)) {
    if (!key) continue; // the root project: it is metadata.component, not a dependency
    if (entry?.link) continue; // a symlink to a local directory; its target is listed separately
    if (!entry?.version) continue;
    if (!includeDev && entry.dev === true) continue;

    const marker = 'node_modules/';
    const at = key.lastIndexOf(marker);
    const name = at === -1 ? key : key.slice(at + marker.length);
    if (!name) continue;

    const purl = purlNpm(name, entry.version);
    if (byPurl.has(purl)) continue;
    const declared = licenses(entry.license);
    const hashes = hashesFromIntegrity(entry.integrity);
    byPurl.set(purl, {
      type: 'library',
      'bom-ref': purl,
      name,
      version: entry.version,
      purl,
      ...(declared ? { licenses: declared } : {}),
      ...(hashes ? { hashes } : {}),
      ...(entry.resolved ? { externalReferences: [{ type: 'distribution', url: entry.resolved }] } : {}),
    });
  }

  return [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl));
}

/** Components from `pip list --format=json` output (already parsed). */
export function componentsFromPipList(list) {
  const byPurl = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    const name = row?.name;
    const version = row?.version;
    if (!name || !version) continue;
    const purl = purlPypi(name, version);
    if (byPurl.has(purl)) continue;
    byPurl.set(purl, { type: 'library', 'bom-ref': purl, name, version, purl });
  }
  return [...byPurl.values()].sort((a, b) => a.purl.localeCompare(b.purl));
}

/**
 * A serial number derived from the content, so two builds of the same tree
 * produce the same document instead of two documents that differ by a UUID.
 */
export function serialFor(components) {
  const digest = crypto
    .createHash('sha256')
    .update(components.map((c) => c.purl).join('\n'))
    .digest('hex');
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
  return `urn:uuid:${uuid}`;
}

/**
 * Read a pinned build time: epoch seconds (the SOURCE_DATE_EPOCH convention) or
 * an ISO instant. `null` when the value is absent or unreadable — a caller that
 * was ASKED for a reproducible document must refuse rather than quietly stamp
 * the wall clock on it.
 */
export function resolveTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const asDate = /^\d+$/.test(raw) ? new Date(Number(raw) * 1000) : new Date(raw);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

/**
 * The timestamp a document gets when nothing pinned one.
 *
 * WHY THIS EXISTS AT ALL: everything else in the document is already derived
 * from its content — the component lists are sorted, the serial number is a
 * hash of them — so the clock was the single reason two builds of one tag
 * differed byte for byte, and an operator could not check that the SBOM
 * attached to a release is the one this tree produces. `SOURCE_DATE_EPOCH` is
 * the cross-ecosystem convention for exactly this; the release workflow sets it
 * from the tagged commit's own timestamp.
 */
export function defaultTimestamp(env = process.env) {
  return resolveTimestamp(env.SOURCE_DATE_EPOCH) ?? new Date().toISOString();
}

export function buildSbom({
  name = 'kp',
  version,
  commit = null,
  image = null,
  npm = [],
  python = [],
  timestamp = defaultTimestamp(),
}) {
  const components = [...npm, ...python];
  const properties = [
    { name: 'kp:npm:scope', value: 'package-lock.json production closure (dev dependencies excluded)' },
    { name: 'kp:python:scope', value: 'resolved pip environment (direct pins and transitives)' },
    { name: 'kp:npm:components', value: String(npm.length) },
    { name: 'kp:python:components', value: String(python.length) },
  ];
  if (commit) properties.push({ name: 'kp:commit', value: commit });
  if (image) properties.push({ name: 'kp:image', value: image });

  return {
    bomFormat: 'CycloneDX',
    specVersion: SPEC_VERSION,
    serialNumber: serialFor(components),
    version: 1,
    metadata: {
      timestamp,
      tools: {
        components: [
          { type: 'application', name: 'scripts/release/sbom.mjs', version: '1.0.0', publisher: 'kp' },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': `pkg:generic/${name}@${version}`,
        name,
        version,
        purl: `pkg:generic/${name}@${version}`,
        licenses: [{ license: { id: 'AGPL-3.0-only' } }],
        ...(image ? { externalReferences: [{ type: 'distribution', url: `oci://${image}` }] } : {}),
      },
      properties,
    },
    components,
  };
}

/**
 * The invariant the release depends on. Pure, so a fixture can assert it.
 * @returns string[] problems (empty = usable)
 */
export function checkSbom(doc, { requirePython = true } = {}) {
  const problems = [];
  if (doc?.bomFormat !== 'CycloneDX' || doc?.specVersion !== SPEC_VERSION) {
    problems.push('not a CycloneDX 1.5 document');
  }
  if (!doc?.metadata?.component?.version) problems.push('no version on the subject component');
  const npm = (doc?.components ?? []).filter((c) => c.purl?.startsWith('pkg:npm/'));
  const py = (doc?.components ?? []).filter((c) => c.purl?.startsWith('pkg:pypi/'));
  if (npm.length < MIN_NPM_COMPONENTS) {
    problems.push(`only ${npm.length} npm components (< ${MIN_NPM_COMPONENTS}) — the lockfile was not read`);
  }
  if (requirePython && py.length < MIN_PYTHON_COMPONENTS) {
    problems.push(
      `only ${py.length} python components (< ${MIN_PYTHON_COMPONENTS}) — the pipeline environment was not read; ` +
        'run this where `pip install -r requirements.txt` has run, or pass --npm-only deliberately',
    );
  }
  return problems;
}

// --- plumbing ---------------------------------------------------------------

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel), 'utf8'));
}

/** `pip list --format=json` from the interpreter the app itself spawns. */
export function pipList() {
  const candidates = [process.env.PYTHON_CMD, 'python3', 'python'].filter(Boolean);
  for (const cmd of candidates) {
    try {
      const out = execFileSync(cmd, ['-m', 'pip', 'list', '--format=json'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return JSON.parse(out);
    } catch {
      // try the next interpreter
    }
  }
  return null;
}

export function parseArgs(argv) {
  const out = { out: null, version: null, commit: null, image: null, timestamp: null, npmOnly: false, includeDev: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--timestamp') out.timestamp = argv[++i];
    else if (argv[i] === '--version') out.version = argv[++i];
    else if (argv[i] === '--commit') out.commit = argv[++i];
    else if (argv[i] === '--image') out.image = argv[++i];
    else if (argv[i] === '--npm-only') out.npmOnly = true;
    else if (argv[i] === '--include-dev') out.includeDev = true;
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const pkg = readJson('package.json');
  const version = (args.version ?? pkg.version ?? '0.0.0').replace(/^v/, '');

  // An explicit --timestamp that cannot be read is an error, never a fallback:
  // the caller asked for a reproducible document and would get a clock instead.
  const pinned = args.timestamp === null ? null : resolveTimestamp(args.timestamp);
  if (args.timestamp !== null && pinned === null) {
    process.stderr.write(
      `sbom: --timestamp "${args.timestamp}" is neither epoch seconds nor an ISO instant.\n` +
        '  Pass `git log -1 --format=%cI <ref>` (or the seconds form, %ct).\n',
    );
    return 1;
  }

  const npm = componentsFromLockfile(readJson('package-lock.json'), { includeDev: args.includeDev });
  const list = args.npmOnly ? [] : pipList();
  if (!args.npmOnly && list === null) {
    process.stderr.write(
      'sbom: could not run `pip list` — the Python half of the runtime would be missing.\n' +
        '  Run this where requirements.txt is installed, or pass --npm-only if you\n' +
        '  deliberately want a JS-only document (and say so wherever you publish it).\n',
    );
    return 1;
  }
  const python = componentsFromPipList(list ?? []);

  const doc = buildSbom({
    version,
    commit: args.commit,
    image: args.image,
    npm,
    python,
    timestamp: pinned ?? defaultTimestamp(),
  });

  const problems = checkSbom(doc, { requirePython: !args.npmOnly });
  if (problems.length) {
    process.stderr.write('sbom ✗ refusing to write an incomplete document:\n');
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    return 1;
  }

  const outPath = path.isAbsolute(args.out ?? '')
    ? args.out
    : path.join(REPO_ROOT, args.out ?? `dist/sbom/kp-${version}.cdx.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `sbom ✓ ${doc.components.length} components (${npm.length} npm, ${python.length} python) -> ${outPath}\n`,
  );
  return 0;
}

if (process.argv[1]?.endsWith('sbom.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
