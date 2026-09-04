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
// invented except the vocabulary.
//
// WHERE THE VOCABULARY LIVES, AND WHY NOT HERE ANY MORE. It used to be declared
// twice. This file defined a compact `Agent-Provenance: agent=…; model=…;
// lane=…; task=…` one-liner; `scripts/agent/provenance.mjs` defined a four-key
// `Agent-model`/`Agent-harness`/`Agent-prompt`/`Agent-run` block and refused any
// other `Agent-*` key. Both ran on every commit through commit-msg.mjs, so the
// trailer CONTRIBUTING.md published was REJECTED by the gate as one undefined
// key plus four missing ones — and, in the other direction, the four-key block
// this repository's OWN dispatch lane writes was invisible to the reader below,
// which classified those commits as human. One question, two vocabularies,
// each blind to the other.
//
// `scripts/agent/provenance.mjs` is now the single owner: both spellings, one
// value-rule table, one reader. This file is the QUERY over it, plus the two
// trailers that are not about agents at all.
//
//   npm run provenance                        # HEAD~20..HEAD, human-readable
//   node scripts/release/provenance.mjs --base origin/main --head HEAD
//   node scripts/release/provenance.mjs --json
//
// EXIT CODES: 0 always in query mode — this reports, it does not judge. The
// judging half lives in commit-msg.mjs, which is already a required check.

import { pathToFileURL } from 'node:url';

import { REPO_ROOT, commitsInRange } from './git.mjs';

import { COMPACT_KEY, COMPACT_SHAPE, checkProvenance, parsePairs, readProvenance } from '../agent/provenance.mjs';

export { REPO_ROOT, commitsInRange };

// Re-exported so a caller that already imports the query does not have to know
// which of the two modules owns the parser. There is one implementation.
export { parsePairs, readProvenance };

/**
 * THE VOCABULARY, as a reader meets it. The `Agent-*` half is owned by
 * scripts/agent/provenance.mjs and named here so this table stays the one place
 * a human looks up what a trailer means; the rules that JUDGE it live with the
 * owner, so the two cannot disagree again.
 *
 * Deliberately small. A vocabulary nobody can remember is one nobody writes, and
 * an unwritten trailer is worse than prose because it looks like a fact that was
 * checked.
 */
export const TRAILERS = {
  [COMPACT_KEY]: {
    shape: COMPACT_SHAPE,
    means:
      "an automated lane committed this on an agent's behalf. Semicolon-separated key=value pairs; every key " +
      'optional, at least one required. The one-line spelling, for a lane whose template has room for one trailer.',
  },
  'Agent-model': {
    shape: '<model id> (with Agent-harness, Agent-prompt and Agent-run)',
    means:
      'the four-line spelling of the same fact, for a lane that knows all of it: which model, which driver at which ' +
      'version, a digest of the prompt text, and where the run log is. All four or none — three cannot be joined on.',
  },
  'Co-Authored-By': {
    shape: 'Name <email>',
    means: 'a second author, agent or human. The one trailer this history already carries throughout.',
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

/**
 * What one commit's trailers say about who wrote it.
 * Pure. `commit` is `{subject, body}`.
 */
export function provenanceOf(commit) {
  const trailers = parseTrailers(commit?.body ?? '');
  const get = (key) => trailers.filter((t) => t.key.toLowerCase() === key.toLowerCase()).map((t) => t.value);

  // BOTH spellings, through the one reader. Before this call, the four-key block
  // that .github/workflows/agent-dispatch.yml emits was parsed by nothing here,
  // so every commit this repository's own lane made was counted as a human's.
  const agentRecord = readProvenance(commit?.body ?? '');
  const coAuthors = get('Co-Authored-By');
  const agentCoAuthors = coAuthors.filter((v) => AGENT_CO_AUTHORS.some((re) => re.test(v)));

  return {
    subject: commit?.subject ?? '',
    authorship: agentRecord.form !== 'none' || agentCoAuthors.length ? 'agent' : 'human',
    // `structured` is the difference between "an agent was involved" and "here is
    // the lane, the model and the task". Reported separately so the share of
    // agent commits that are FULLY attributable is visible rather than assumed.
    structured: agentRecord.form !== 'none',
    agents: [...new Set([agentRecord.agent].filter(Boolean))],
    models: [
      ...new Set(
        [
          agentRecord.model,
          // `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` carries the model
          // in the display name. Reading it is what makes today's history queryable
          // at all, rather than only history written after the lane is changed.
          ...agentCoAuthors.map((v) => v.replace(/\s*<[^>]*>\s*$/, '').trim()),
        ].filter(Boolean),
      ),
    ],
    // The compact spelling names the LANE; the expanded one names the DRIVER at a
    // version, which is the same question asked more precisely. Either answers
    // "what produced this", so either fills the column.
    lanes: [...new Set([agentRecord.lane ?? agentRecord.harness].filter(Boolean))],
    tasks: [...new Set([agentRecord.task, ...get('Ascent-Resolves')].filter(Boolean))],
  };
}

/**
 * Validation, applied by the commit-convention gate through commit-msg.mjs. THE
 * ONE ENTRY POINT for a body's trailers: the non-agent vocabulary is judged
 * here, and every `Agent-*` trailer is handed to its owner, called exactly once
 * so a malformed block is reported once rather than twice in two wordings.
 *
 * NARROW ON PURPOSE: it fires only on a trailer that is PRESENT and malformed,
 * never on an absent one. A gate that demanded the trailer would go red on every
 * commit written by a lane that does not yet emit it, and a gate nobody can
 * satisfy is one everybody learns to bypass.
 *
 * @returns string[] problems (empty = nothing malformed)
 */
export function checkTrailers(body) {
  const problems = [];
  for (const { key, value } of parseTrailers(body)) {
    if (/^agent-/i.test(key)) continue; // owned by scripts/agent/provenance.mjs, below
    const spec = Object.keys(TRAILERS).find((k) => k.toLowerCase() === key.toLowerCase());
    if (!spec) continue;

    if (!value) {
      problems.push(`\`${spec}:\` is empty — it should read \`${spec}: ${TRAILERS[spec].shape}\``);
      continue;
    }
    if (spec === 'Co-Authored-By' && !/<[^>]+>/.test(value)) {
      problems.push(`\`Co-Authored-By: ${value}\` has no \`<email>\`, which is what git's own trailer readers key on`);
    }
  }
  return [...problems, ...checkProvenance(body)];
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
    `  fully attributed:  ${s.fullyAttributed} of ${s.agentAuthored} carry a provenance trailer`,
  ];
  if (s.models.length) lines.push('  models:', ...s.models.map(([m, n]) => `    ${n.toString().padStart(4)}  ${m}`));
  if (s.lanes.length) lines.push('  lanes:', ...s.lanes.map(([l, n]) => `    ${n.toString().padStart(4)}  ${l}`));
  if (s.tasks.length) lines.push(`  tasks closed:      ${s.tasks.length} (${s.tasks.slice(0, 8).join(', ')}${s.tasks.length > 8 ? ', …' : ''})`);
  if (s.agentAuthored && s.fullyAttributed < s.agentAuthored) {
    lines.push(
      '',
      `${s.agentAuthored - s.fullyAttributed} agent commit(s) are recognisable only by their co-author line, so the`,
      "lane and the task that produced them are not answerable from the log. That is a change to the lane's",
      `commit template (\`${COMPACT_KEY}: agent=…; model=…; lane=…; task=…\`), not to this repository —`,
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

// Resolved-URL comparison, not `endsWith('provenance.mjs')`: the module this file
// imports is ALSO called provenance.mjs, and a filename guard would fire in both.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
