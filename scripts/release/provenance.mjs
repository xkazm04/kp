#!/usr/bin/env node
// Who wrote this history, asked of `git log` rather than of a person.
//
// THE GAP THIS CLOSES — and the half of it this file does NOT close.
//
// Roughly 43% of the commits here were written by an agent, and the record of
// that is honest: an automated lane that commits on an agent's behalf says so
// rather than impersonating a human. It is honest and it is UNUSABLE. The
// provenance is prose — a sentence in a commit body, phrased a little
// differently each time — so no question about agent-authored change can be
// answered without reading every message by hand:
//
//   which changes did an agent write, and under which model?
//   which of them closed a dispatched task, and which id?
//   when a module went wrong, was the change that touched it agent-authored?
//   is the agent share of this month's commits going up or down?
//
// Each of those is one `git log` away IF the facts are trailers instead of
// sentences. `git log` already understands trailers; nothing here had to be
// invented except the vocabulary, which is below and is documented for humans in
// CONTRIBUTING.md.
//
// WHAT THIS FILE DOES:
//   * defines the vocabulary (TRAILERS) and parses it out of a commit body;
//   * `npm run provenance` — the query, over any range, plain or `--json`;
//   * `checkTrailers()` — the validation the commit-convention CI job applies
//     through scripts/release/commit-msg.mjs, so a trailer that is present and
//     malformed fails rather than being silently unqueryable.
//
// WHAT IT CANNOT DO, STATED PLAINLY: it cannot make a lane write the trailer.
// The parser reads what history already carries — `Co-Authored-By:` (which the
// agent lanes here do write) and `Ascent-Resolves:` — so `npm run provenance`
// answers the questions above on today's history. But the richer facts, model
// and lane, only become queryable once the lane emits `Agent-Provenance:`. That
// is a change to the lane's commit template, not to this repository, and this
// file is deliberately the thing that makes it worth doing: the vocabulary is
// fixed, the reader exists, and the gate is already wired.
//
//   npm run provenance                        # HEAD~20..HEAD, human-readable
//   node scripts/release/provenance.mjs --base origin/main --head HEAD
//   node scripts/release/provenance.mjs --json
//
// EXIT CODES: 0 always in query mode — this reports, it does not judge. The
// judging half lives in commit-msg.mjs, which is already a required check.

import { REPO_ROOT, commitsInRange } from './git.mjs';

export { REPO_ROOT, commitsInRange };

/**
 * THE VOCABULARY. Each entry is a trailer key, whether a well-formed value is
 * required to look like anything in particular, and what a reader gets from it.
 *
 * Deliberately small. A vocabulary nobody can remember is one nobody writes, and
 * an unwritten trailer is worse than prose because it looks like a fact that was
 * checked.
 */
export const TRAILERS = {
  'Agent-Provenance': {
    shape: 'agent=<name>; model=<id>; lane=<name>; task=<id>',
    means: 'an automated lane committed this on an agent\'s behalf. Semicolon-separated key=value pairs; every key optional, at least one required.',
  },
  'Co-Authored-By': {
    shape: 'Name <email>',
    means: 'a second author, agent or human. The one trailer this history already carries.',
  },
  'Ascent-Resolves': {
    shape: '<task-id>',
    means: 'the dispatched task this change closes.',
  },
};

/** Names that mean "this co-author is a model, not a person". */
const AGENT_CO_AUTHORS = [/\bclaude\b/i, /\bcodex\b/i, /\bcopilot\b/i, /\bgpt-/i, /\bgemini\b/i, /\bdevin\b/i];

/** `Key: value` lines in the trailer block. Pure; the whole body is scanned because git's own parser is lenient about blank lines. */
export function parseTrailers(body) {
  const out = [];
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line.trim());
    if (m) out.push({ key: m[1], value: m[2].trim() });
  }
  return out;
}

/** `a=1; b=2` → `{a: '1', b: '2'}`. Tolerant of spacing; ignores anything with no `=`. */
export function parsePairs(value) {
  const out = {};
  for (const part of String(value ?? '').split(/\s*;\s*/)) {
    const m = /^([A-Za-z][\w-]*)\s*=\s*(.+)$/.exec(part.trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * What one commit's trailers say about who wrote it.
 * Pure. `commit` is `{subject, body}`.
 */
export function provenanceOf(commit) {
  const trailers = parseTrailers(commit?.body ?? '');
  const get = (key) => trailers.filter((t) => t.key.toLowerCase() === key.toLowerCase()).map((t) => t.value);

  const structured = get('Agent-Provenance').map(parsePairs);
  const coAuthors = get('Co-Authored-By');
  const agentCoAuthors = coAuthors.filter((v) => AGENT_CO_AUTHORS.some((re) => re.test(v)));

  const agents = [...new Set(structured.map((p) => p.agent).filter(Boolean))];
  const models = [
    ...new Set([
      ...structured.map((p) => p.model).filter(Boolean),
      // `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` carries the model
      // in the display name. Reading it is what makes today's history queryable
      // at all, rather than only history written after the lane is changed.
      ...agentCoAuthors.map((v) => v.replace(/\s*<[^>]*>\s*$/, '').trim()).filter(Boolean),
    ]),
  ];

  return {
    subject: commit?.subject ?? '',
    authorship: structured.length || agentCoAuthors.length ? 'agent' : 'human',
    // `structured` is the difference between "an agent was involved" and "here is
    // the lane, the model and the task". Reported separately so the share of
    // agent commits that are FULLY attributable is visible rather than assumed.
    structured: structured.length > 0,
    agents,
    models,
    lanes: [...new Set(structured.map((p) => p.lane).filter(Boolean))],
    tasks: [...new Set([...structured.map((p) => p.task).filter(Boolean), ...get('Ascent-Resolves').filter(Boolean)])],
  };
}

/**
 * Validation, applied by the commit-convention gate through commit-msg.mjs.
 *
 * NARROW ON PURPOSE: it fires only on a trailer that is PRESENT and malformed,
 * never on an absent one. A gate that demanded the trailer would go red on every
 * commit written by a lane that does not yet emit it — which is every lane today
 * — and a gate nobody can satisfy is one everybody learns to bypass. Requiring it
 * is the follow-up, once the lanes write it.
 *
 * @returns string[] problems (empty = nothing malformed)
 */
export function checkTrailers(body) {
  const problems = [];
  for (const { key, value } of parseTrailers(body)) {
    const spec = Object.keys(TRAILERS).find((k) => k.toLowerCase() === key.toLowerCase());
    if (!spec) continue;

    if (!value) {
      problems.push(`\`${spec}:\` is empty — it should read \`${spec}: ${TRAILERS[spec].shape}\``);
      continue;
    }
    if (spec === 'Agent-Provenance' && Object.keys(parsePairs(value)).length === 0) {
      problems.push(
        `\`Agent-Provenance: ${value}\` holds no \`key=value\` pair, so nothing can read it — ` +
          `the shape is \`${TRAILERS['Agent-Provenance'].shape}\``,
      );
    }
    if (spec === 'Co-Authored-By' && !/<[^>]+>/.test(value)) {
      problems.push(`\`Co-Authored-By: ${value}\` has no \`<email>\`, which is what git's own trailer readers key on`);
    }
  }
  return problems;
}

/** Roll a set of commits up into the answers the questions above want. */
export function summarize(commits) {
  const rows = commits.map(provenanceOf);
  const agent = rows.filter((r) => r.authorship === 'agent');
  const tally = (key) => {
    const counts = new Map();
    for (const r of agent) for (const v of r[key]) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  return {
    total: rows.length,
    agentAuthored: agent.length,
    fullyAttributed: agent.filter((r) => r.structured).length,
    models: tally('models'),
    lanes: tally('lanes'),
    tasks: [...new Set(agent.flatMap((r) => r.tasks))],
    rows,
  };
}

export function render(s, range) {
  if (s.total === 0) return `provenance: no commits in ${range}.`;
  const pct = (n) => `${Math.round((n / s.total) * 100)}%`;
  const lines = [
    `provenance over ${range} — ${s.total} commit(s)`,
    `  agent-authored:    ${s.agentAuthored} (${pct(s.agentAuthored)})`,
    `  fully attributed:  ${s.fullyAttributed} of ${s.agentAuthored} carry an Agent-Provenance trailer`,
  ];
  if (s.models.length) lines.push('  models:', ...s.models.map(([m, n]) => `    ${n.toString().padStart(4)}  ${m}`));
  if (s.lanes.length) lines.push('  lanes:', ...s.lanes.map(([l, n]) => `    ${n.toString().padStart(4)}  ${l}`));
  if (s.tasks.length) lines.push(`  tasks closed:      ${s.tasks.length} (${s.tasks.slice(0, 8).join(', ')}${s.tasks.length > 8 ? ', …' : ''})`);
  if (s.agentAuthored && s.fullyAttributed < s.agentAuthored) {
    lines.push(
      '',
      `${s.agentAuthored - s.fullyAttributed} agent commit(s) are recognisable only by their co-author line, so the`,
      'lane and the task that produced them are not answerable from the log. That is a change to the lane\'s',
      'commit template (`Agent-Provenance: agent=…; model=…; lane=…; task=…`), not to this repository —',
      'CONTRIBUTING.md “Provenance trailers” states the shape it should write.',
    );
  }
  return lines.join('\n');
}

// --- cli --------------------------------------------------------------------
//
// The git plumbing is ./git.mjs, shared with the release scripts. This query
// reads bodies only, so it does not ask for each commit's files.

export function parseArgs(argv) {
  const out = { base: null, head: 'HEAD', json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

if (process.argv[1]?.endsWith('provenance.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base ?? `${args.head}~20`;
  let commits = [];
  try {
    commits = commitsInRange(base, args.head);
  } catch {
    process.stdout.write(`provenance: no comparable range (${base}..${args.head}) — nothing to report.\n`);
    process.exit(0);
  }
  const summary = summarize(commits);
  process.stdout.write(args.json ? `${JSON.stringify(summary, null, 2)}\n` : `${render(summary, `${base}..${args.head}`)}\n`);
  process.exit(0);
}
