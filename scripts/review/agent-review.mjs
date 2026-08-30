#!/usr/bin/env node
// The judgement half of "something reads the change back".
//
// constitution-check.mjs (beside this file) catches the mechanical moves that
// weaken a gate. It cannot tell whether a change does what its commit message
// says, whether it quietly widened its own scope, or whether it just reversed a
// decision recorded in docs/architecture/decisions/. That judgement currently
// lives in one maintainer's head and does not scale with agent throughput —
// which is the whole reason this file exists.
//
// The rubric is not a generic "good code" prior: rubric.mjs assembles it from
// THIS repository's own written rules (.claude/CLAUDE.md conventions, the
// design-system law, the doc-sync obligation, the ADR set). There is no second
// copy of the rules to drift.
//
//   node scripts/review/agent-review.mjs --base origin/main --head HEAD
//   npm run review:agent
//
// BACKENDS, in resolution order:
//   1. ANTHROPIC_API_KEY  -> the Messages API (this is the CI path)
//   2. the `claude` CLI on PATH -> the local default provider for this repo,
//      so a maintainer gets the same review with no key at all
//   3. neither -> print that the judgement lens DID NOT RUN and exit 0
//
// (3) is honest, not a silent pass: the deterministic lens has already gated the
// change, and a review that claims to have happened when it did not is worse
// than an absent one. The exit code says "not blocked"; the output says "not
// reviewed". CI prints both.
//
// EXIT CODES: 0 no blocking finding (or lens unavailable) · 1 blocking finding
// · 2 the lens ran and failed (bad key, malformed response) — a real error,
// distinguishable from a clean pass.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  diffForRange,
  messagesForRange,
  parseDiff,
  resolveRange,
  revExists,
} from './diff.mjs';
import { buildRubric } from './rubric.mjs';

const DEFAULT_MODEL = process.env.KP_REVIEW_MODEL || 'claude-sonnet-5';
const DIFF_BUDGET = Number(process.env.KP_REVIEW_DIFF_BUDGET || 160_000);

export function parseArgs(argv) {
  const out = { base: null, head: 'HEAD', out: null, json: false, model: DEFAULT_MODEL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--model') out.model = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

/** Trim the diff to a byte budget, whole files first, and say what was dropped. */
export function budgetDiff(diffText, budget = DIFF_BUDGET) {
  if (diffText.length <= budget) return { text: diffText, truncated: false, droppedChars: 0 };
  const cut = diffText.lastIndexOf('\ndiff --git ', budget);
  const at = cut > budget / 2 ? cut : budget;
  return {
    text: diffText.slice(0, at),
    truncated: true,
    droppedChars: diffText.length - at,
  };
}

export const SYSTEM_PROMPT = [
  'You are reviewing a change to a codebase where roughly 90% of commits are written by an',
  'AI agent. Deterministic gates (typecheck, lint, unit tests, a design-token linter, a',
  'locale-parity checker, a separate regex pass over the diff) have ALREADY run and are',
  'green. Do not repeat them: style, formatting, missing semicolons, "add a test" in the',
  'abstract, and anything a linter would catch are out of scope.',
  '',
  'Your job is the judgement those gates cannot make:',
  '  1. INTENT — does the change do what its commit message claims, no more and no less?',
  '  2. SCOPE — did it quietly widen? An unrelated refactor, a renamed export, a changed',
  '     default, a loosened type, a deleted branch of behaviour nobody asked about.',
  '  3. CONSTITUTION — does it violate a rule in the rubric below? Cite the rule.',
  '  4. REVERSED DECISION — does it undo something in the ADR list without adding a',
  '     superseding record? That is a finding even when the code is good.',
  '  5. TRUTHFULNESS — does it claim success where it cannot know (a "sent" that is only',
  '     queued, a silent catch, a fallback that reports as a real result)?',
  '',
  'Severity discipline, and this is the important part: use "blocking" ONLY when you can',
  'name the specific rule or decision that is broken AND point at the line that breaks it.',
  'Everything you are less sure about is "note". A reviewer who blocks on a hunch gets',
  'switched off, and then it protects nothing. If the change is fine, return no findings —',
  'that is a normal and frequent answer, not a failure to look hard enough.',
].join('\n');

export function buildPrompt({ rubric, diff, messages, truncated, droppedChars, files }) {
  return [
    '# The project constitution (its own words)',
    '',
    rubric,
    '',
    '# What the change says about itself',
    '',
    '```',
    messages.trim() || '(no commit message in range)',
    '```',
    '',
    `# Files touched (${files.length})`,
    '',
    files.map((f) => `- ${f}`).join('\n'),
    '',
    '# The diff',
    truncated
      ? `\n(TRUNCATED: ${droppedChars} characters of later files were dropped. Review what is here; ` +
        'do not speculate about what is missing, and say in "summary" that the review was partial.)\n'
      : '',
    '',
    '```diff',
    diff,
    '```',
    '',
    '# Answer',
    '',
    'Reply with ONE fenced json block and nothing else:',
    '',
    '```json',
    '{',
    '  "summary": "one or two sentences: what this change does, and whether it matches its stated intent",',
    '  "findings": [',
    '    {',
    '      "severity": "blocking" | "note",',
    '      "category": "intent" | "scope" | "constitution" | "reversed-decision" | "truthfulness",',
    '      "file": "path/from/repo/root.ts",',
    '      "line": 123,',
    '      "rule": "the named rule or ADR this breaks, or null for intent/scope findings",',
    '      "finding": "what is wrong, in one sentence",',
    '      "why": "the concrete consequence — inputs or state -> wrong behaviour"',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');
}

/** Extract the JSON object from a model reply that may be fenced or bare. */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    // Last resort: the outermost {...} span.
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    try {
      return JSON.parse(candidate.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

async function callAnthropic({ model, system, prompt, apiKey }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const body = await res.json();
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function claudeCliAvailable() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
    encoding: 'utf8',
  });
  return probe.status === 0;
}

function callClaudeCli({ system, prompt }) {
  // `claude -p` reads the prompt from stdin and prints the reply. The system
  // rules ride at the top of the prompt: the CLI's own flags vary by version and
  // this path must keep working across upgrades.
  const res = spawnSync('claude', ['-p'], {
    input: `${system}\n\n---\n\n${prompt}`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`claude CLI exited ${res.status}: ${(res.stderr || '').slice(0, 400)}`);
  }
  return res.stdout;
}

/**
 * The verdict, as an exit code. Extracted from main() so a fixture can pin it:
 * "blocking means the build fails" is the whole difference between a reviewer
 * with teeth and a comment nobody has to answer.
 * @returns 0 nothing blocking · 1 at least one blocking finding
 */
export function verdictFor(findings) {
  return findings.some((f) => f?.severity === 'blocking') ? 1 : 0;
}

export function renderMarkdown({ backend, model, summary, findings, truncated }) {
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const notes = findings.filter((f) => f.severity !== 'blocking');
  const lines = [];
  lines.push('## Agent review');
  lines.push('');
  lines.push(`_${backend}${model ? ` · ${model}` : ''}${truncated ? ' · partial diff' : ''}_`);
  lines.push('');
  if (summary) lines.push(`${summary}\n`);
  if (!findings.length) {
    lines.push('No finding. Intent, scope and the project constitution all read clean.');
    return lines.join('\n');
  }
  lines.push(`**${blocking.length} blocking · ${notes.length} to note**`);
  lines.push('');
  for (const f of [...blocking, ...notes]) {
    const glyph = f.severity === 'blocking' ? '✗' : '–';
    const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '_(no location)_';
    lines.push(`${glyph} **[${f.category ?? 'finding'}]** ${where}${f.rule ? ` — ${f.rule}` : ''}`);
    lines.push(`  ${f.finding}`);
    if (f.why) lines.push(`  _${f.why}_`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main(argv) {
  const args = parseArgs(argv);
  const range = resolveRange(args, revExists);
  if (!revExists(range.base)) {
    process.stdout.write(`agent-review: no comparable base (${range.base}) — review skipped.\n`);
    return 0;
  }

  const rawDiff = diffForRange(range);
  const files = [...parseDiff(rawDiff).keys()];
  if (!files.length) {
    process.stdout.write('agent-review: no changes in range.\n');
    return 0;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasCli = !apiKey && claudeCliAvailable();
  if (!apiKey && !hasCli) {
    // Deliberately loud, deliberately exit 0. See the header.
    process.stdout.write(
      'agent-review: THE JUDGEMENT LENS DID NOT RUN.\n' +
        '  No ANTHROPIC_API_KEY and no `claude` CLI on PATH, so intent, scope and\n' +
        '  ADR-reversal were NOT reviewed on this change. The deterministic lens\n' +
        '  (scripts/review/constitution-check.mjs) did run and is what gated it.\n' +
        '  To enable this lens: set ANTHROPIC_API_KEY, or install the Claude CLI.\n',
    );
    return 0;
  }

  const { text: diff, truncated, droppedChars } = budgetDiff(rawDiff);
  const prompt = buildPrompt({
    rubric: buildRubric(),
    diff,
    messages: messagesForRange(range),
    truncated,
    droppedChars,
    files,
  });

  const backend = apiKey ? 'Anthropic API' : 'Claude CLI';
  let reply;
  try {
    reply = apiKey
      ? await callAnthropic({ model: args.model, system: SYSTEM_PROMPT, prompt, apiKey })
      : callClaudeCli({ system: SYSTEM_PROMPT, prompt });
  } catch (err) {
    process.stderr.write(`agent-review: the lens FAILED to run — ${err.message}\n`);
    return 2;
  }

  const parsed = extractJson(reply);
  if (!parsed || !Array.isArray(parsed.findings)) {
    process.stderr.write(
      `agent-review: the lens returned something unparsable. First 600 chars:\n${String(reply).slice(0, 600)}\n`,
    );
    return 2;
  }

  const findings = parsed.findings.filter(Boolean);
  const md = renderMarkdown({
    backend,
    model: apiKey ? args.model : null,
    summary: parsed.summary,
    findings,
    truncated,
  });

  if (args.out) fs.writeFileSync(args.out, `${md}\n`, 'utf8');
  process.stdout.write(args.json ? `${JSON.stringify({ ...parsed, backend, truncated }, null, 2)}\n` : `${md}\n`);

  return verdictFor(findings);
}

if (process.argv[1]?.endsWith('agent-review.mjs')) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
