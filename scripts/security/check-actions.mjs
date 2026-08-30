#!/usr/bin/env node
// Every workflow scopes its token, and no NEW action floats on a mutable tag.
//
// THE GAP THIS CLOSES: `ci.yml`'s header says every action is pinned to a full
// commit SHA. That was true of `ci.yml` and of nothing else — `release.yml` and
// `security.yml` carry tag-pinned actions, and `release.yml` is the workflow with
// `packages: write`, `id-token: write` and `attestations: write`: the one that
// signs and publishes the image an operator pins to. A tag is a pointer its owner
// can move. That is the reach a supply-chain compromise wants.
//
// It also caught a `permissions:`-less workflow (`ai-review.yml`, a scaffold that
// echoed a TODO and reported a green "AI review" check), which is now deleted.
//
// A RATCHET, NOT A SWEEP — the same shape as ruff.toml:
//
//   The refs below are the ones that float TODAY. Each is listed with why it is
//   still floating. The check passes with the list and FAILS on anything not in
//   it, so the debt is enumerable, it cannot grow, and burning it down is deleting
//   entries. Never add an entry to make a red build green without saying why here.
//
// WHY THE LIST IS NOT SIMPLY EMPTIED: resolving a tag to its commit SHA requires
// asking GitHub what the tag currently points at. Inventing a SHA does not pin an
// action, it breaks the workflow. `--resolve` does the lookup and rewrites the
// files in place; it needs network, so it is a maintainer command, not a CI step.
//
// THE DOCKERFILE IS DELIBERATELY OUT OF SCOPE. `ARG NODE_IMAGE=node:24-bookworm-slim`
// is a build-arg DEFAULT whose whole purpose is to be overridden (its header says
// so: swap the base to get a different Python minor, or a different arch). Pinning
// a self-hoster's overridable base by digest would freeze the one knob the image
// exposes, and the artifact operators actually pin — the published image — is
// already immutable by digest and carries a provenance attestation (release.yml).
// The exposure here is a build-time base, not a signed published one.
//
//   npm run security:actions              # the ratchet (CI runs this)
//   npm run security:actions -- --resolve # rewrite the allowlisted refs to SHAs
//   npm run security:actions -- --json
//
// EXIT CODES: 0 clean · 1 an unpinned ref outside the allowlist, or a workflow
// with no `permissions:` block.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../review/diff.mjs';

export const WORKFLOW_DIR = '.github/workflows';

// Known-floating refs. `ref` is matched exactly against the text after `@`.
export const PIN_ALLOWLIST = [
  {
    uses: 'github/codeql-action/init',
    ref: 'v3',
    why: 'SHA never verified against the API (see security.yml). Burn down with --resolve.',
  },
  { uses: 'github/codeql-action/autobuild', ref: 'v3', why: 'same tag as codeql-action/init.' },
  { uses: 'github/codeql-action/analyze', ref: 'v3', why: 'same tag as codeql-action/init.' },
  { uses: 'actions/upload-artifact', ref: 'v4', why: 'SHA never verified against the API (see release.yml).' },
  { uses: 'actions/download-artifact', ref: 'v4', why: 'SHA never verified against the API (see release.yml).' },
  { uses: 'actions/attest-build-provenance', ref: 'v2', why: 'SHA never verified against the API (see release.yml).' },
  { uses: 'docker/setup-buildx-action', ref: 'v3', why: 'SHA never verified against the API (see release.yml).' },
  { uses: 'docker/login-action', ref: 'v3', why: 'SHA never verified against the API (see release.yml).' },
  { uses: 'docker/build-push-action', ref: 'v6', why: 'SHA never verified against the API (see release.yml).' },
];

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*(?:-\s*)?uses:\s*(['"]?)([^'"\s#]+)\1/;

/** A ref is pinned when it is a full commit SHA, or the action is local to this repo. */
export function isPinned(uses) {
  if (uses.startsWith('./') || uses.startsWith('.\\')) return true; // a path in this tree
  if (uses.startsWith('docker://')) return /@sha256:[0-9a-f]{64}$/.test(uses);
  const at = uses.lastIndexOf('@');
  if (at === -1) return false;
  return SHA_RE.test(uses.slice(at + 1));
}

export function splitUses(uses) {
  const at = uses.lastIndexOf('@');
  return at === -1 ? { action: uses, ref: null } : { action: uses.slice(0, at), ref: uses.slice(at + 1) };
}

export function allowlisted(uses, allowlist = PIN_ALLOWLIST) {
  const { action, ref } = splitUses(uses);
  return allowlist.find((e) => e.uses === action && e.ref === ref) ?? null;
}

/** Every `uses:` in a workflow, with its 1-based line number. */
export function usesIn(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const m = USES_RE.exec(line);
    if (m) out.push({ uses: m[2], line: i + 1 });
  });
  return out;
}

/**
 * A workflow must scope GITHUB_TOKEN at the top level. Job-level `permissions:`
 * blocks are additive per job and say nothing about the jobs that lack one, so
 * they do not substitute: without the top-level block those jobs inherit the
 * repository default, which is write-all on many repositories.
 */
export function hasTopLevelPermissions(text) {
  return /^permissions:/m.test(text);
}

const finding = (severity, rule, file, line, message, fix) => ({ severity, rule, file, line, message, fix });

/** Pure. `files` is `[{file, text}]`. */
export function runChecks(files, allowlist = PIN_ALLOWLIST) {
  const out = [];
  const seen = new Set();

  for (const { file, text } of files) {
    if (!hasTopLevelPermissions(text)) {
      out.push(
        finding(
          'blocking',
          'no-permissions',
          file,
          1,
          'This workflow has no top-level `permissions:` block.',
          'Every job in it inherits the repository default for GITHUB_TOKEN. Add `permissions:\\n  contents: read` ' +
            'and widen per job only where a job genuinely writes something.',
        ),
      );
    }

    for (const { uses, line } of usesIn(text)) {
      if (isPinned(uses)) continue;
      const entry = allowlisted(uses, allowlist);
      if (entry) {
        seen.add(`${entry.uses}@${entry.ref}`);
        out.push(
          finding('warn', 'unpinned-known', file, line, `${uses} floats on a mutable tag.`, `Known debt — ${entry.why}`),
        );
        continue;
      }
      out.push(
        finding(
          'blocking',
          'unpinned',
          file,
          line,
          `${uses} is pinned to a mutable ref.`,
          'Pin it to the full commit SHA with a trailing `# vX.Y.Z` comment (Dependabot updates both). ' +
            '`npm run security:actions -- --resolve` does the lookup. Do not add it to PIN_ALLOWLIST to ' +
            'make this pass — the list is debt already incurred, not a way to incur more.',
        ),
      );
    }
  }

  // A stale allowlist entry is its own kind of rot: it reads as "still floating"
  // long after the ref was pinned or the step deleted, and the next reader trusts
  // it. Deleting entries is how this list is supposed to end.
  for (const entry of allowlist) {
    if (!seen.has(`${entry.uses}@${entry.ref}`)) {
      out.push(
        finding(
          'blocking',
          'stale-allowlist',
          'scripts/security/check-actions.mjs',
          1,
          `PIN_ALLOWLIST still lists ${entry.uses}@${entry.ref}, which no workflow uses.`,
          'Delete the entry. An allowlist that outlives what it excused is how the exception becomes the rule.',
        ),
      );
    }
  }

  return out;
}

export function loadWorkflows(root = REPO_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ file: `${WORKFLOW_DIR}/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

// --- --resolve: the only honest way to empty the allowlist --------------------

const API = 'https://api.github.com';

/**
 * Resolve `owner/repo[/sub]@tag` to the COMMIT sha the tag points at.
 * An annotated tag points at a tag object, which must be dereferenced — pinning
 * to the tag object's own sha would not match what Actions resolves.
 */
export async function resolveRef(uses, { token = null, fetchImpl = fetch } = {}) {
  const { action, ref } = splitUses(uses);
  const [owner, repo] = action.split('/');
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'kp-check-actions',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const get = async (url) => {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
    return res.json();
  };
  const obj = (await get(`${API}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(ref)}`)).object;
  if (obj.type === 'commit') return { sha: obj.sha, tag: ref };
  const deref = (await get(`${API}/repos/${owner}/${repo}/git/tags/${obj.sha}`)).object;
  return { sha: deref.sha, tag: ref };
}

export function rewriteUses(text, uses, sha, tag) {
  const { action } = splitUses(uses);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = USES_RE.exec(line);
      if (!m || m[2] !== uses) return line;
      // Keep the indentation and any leading `- `; replace the whole rest of the
      // line, which is why this only ever runs on refs that carry no comment yet.
      return `${line.slice(0, m[0].indexOf('uses:'))}uses: ${action}@${sha} # ${tag}`;
    })
    .join('\n');
}

// --- CLI ---------------------------------------------------------------------

export function parseArgs(argv) {
  return { resolve: argv.includes('--resolve'), json: argv.includes('--json') };
}

export function render(findings) {
  if (findings.length === 0) return 'check-actions: every action is pinned and every workflow scopes its token.';
  const lines = findings.map(
    (f) => `${f.severity === 'blocking' ? 'BLOCK' : ' note'}  ${f.file}:${f.line}  [${f.rule}] ${f.message}\n        ${f.fix}`,
  );
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  lines.push('', `${blocking} blocking, ${findings.length - blocking} note(s).`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = loadWorkflows();

  if (args.resolve) {
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
    for (const f of files) {
      let text = f.text;
      let changed = false;
      for (const { uses } of usesIn(text)) {
        if (isPinned(uses)) continue;
        const { sha, tag } = await resolveRef(uses, { token });
        text = rewriteUses(text, uses, sha, tag);
        changed = true;
        console.log(`  ${f.file}: ${uses} -> ${sha} # ${tag}`);
      }
      if (changed) fs.writeFileSync(path.join(REPO_ROOT, f.file), text);
    }
    console.log('check-actions: resolved. Delete the PIN_ALLOWLIST entries you just burned down, then re-run.');
    return;
  }

  const findings = runChecks(files);
  if (args.json) console.log(JSON.stringify(findings, null, 2));
  else console.log(render(findings));
  process.exit(findings.some((f) => f.severity === 'blocking') ? 1 : 0);
}

if (process.argv[1]?.endsWith('check-actions.mjs')) {
  main().catch((err) => {
    console.error(`check-actions: ${err.message}`);
    process.exit(1);
  });
}
