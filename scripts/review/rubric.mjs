#!/usr/bin/env node
// Assemble the review rubric from the repository's OWN written rules.
//
// The point is that the reviewer is judged against this project's constitution,
// not against a generic "good code" prior. Everything here is read from files
// that already exist and are already maintained — no second copy of the rules
// to drift out of date.
//
// Order matters: the rules most often broken by an agent working fast come
// first, because a long rubric gets skimmed at the bottom too.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './diff.mjs';

/** Read a repo file, or '' when absent (a rubric source is never load-bearing). */
export function readIfPresent(rel) {
  const p = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** Pull one `## Heading` section out of a markdown document. */
export function section(markdown, heading) {
  if (!markdown) return '';
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(`## ${heading.toLowerCase()}`));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** ADR id + title + the "what would change our mind" line, from front matter. */
export function adrSummaries(dir = 'docs/architecture/decisions') {
  const abs = path.join(REPO_ROOT, dir);
  let files = [];
  try {
    files = fs.readdirSync(abs).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const text = fs.readFileSync(path.join(abs, file), 'utf8');
    const id = text.match(/^id:\s*"?(\d{4})"?/m)?.[1] ?? '????';
    const title = text.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? file;
    const status = text.match(/^status:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown';
    return { id, title, status, file: `${dir}/${file}` };
  });
}

export function buildRubric() {
  const claude = readIfPresent('.claude/CLAUDE.md');
  const conventions = section(claude, 'Important Conventions');
  const design = section(claude, 'Design system');
  const docsync = section(claude, 'Documentation Sync');
  const adrs = adrSummaries();

  const parts = [];

  parts.push(
    [
      '## What this project treats as non-negotiable',
      '',
      conventions || '(app conventions file unavailable)',
    ].join('\n'),
  );

  if (design) parts.push(['## Design-system law (both themes, always)', '', design].join('\n'));
  if (docsync) parts.push(['## Documentation-sync obligation', '', docsync].join('\n'));

  if (adrs.length) {
    parts.push(
      [
        '## Settled decisions (ADRs). A change that reverses one of these is a finding,',
        '## however good the code is — unless the change ADDS a superseding record.',
        '',
        ...adrs.map((a) => `- ADR ${a.id} (${a.status}): ${a.title} — ${a.file}`),
      ].join('\n'),
    );
  }

  parts.push(
    [
      '## Recurring patterns worth imitating (from the same file)',
      '',
      '- Closed vocabularies: literal array + derived union + runtime guard.',
      '- IMMEDIATE transactions for read -> compute -> write.',
      '- Truthful delivery claims: `sent` / `queued` / `failed`. Never a green lie.',
      '- Per-IP / per-token rateLimit() on every open route that spends money or spawns a subprocess.',
      '- Public [token] routes return an explicit field projection, never a store row.',
      '- Keyless paths degrade to a deterministic answer, never to an error.',
    ].join('\n'),
  );

  return parts.join('\n\n');
}

if (process.argv[1]?.endsWith('rubric.mjs')) {
  process.stdout.write(`${buildRubric()}\n`);
}
