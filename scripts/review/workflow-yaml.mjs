#!/usr/bin/env node
// ONE reader for `.github/workflows`, shared by every gate that has to answer a
// question about them.
//
// WHY THIS FILE EXISTS: there used to be two. `gate-check.mjs` hand-rolled
// `significantLines`/`keysAt`/`listAt` to answer "what triggers this workflow,
// what are its jobs called, is the token scoped"; `check-actions.mjs` hand-rolled
// `triggersIn`/`jobPermissions`/`usesIn`/`checkoutSteps` to answer an overlapping
// set. They disagreed on shapes neither author had in front of them — a quoted
// `"on":` key, an `on: push` scalar, a trigger block indented four spaces — and
// because each gate carried its own copy, a fix to one of them propagated to
// nothing. A workflow shape that tripped one reader walked past the other.
//
// DELIBERATELY NOT A YAML PARSER. Both gates run in jobs that have not run
// `npm ci` (the pin-actions workflow, the pre-push hook's fast core), so a
// dependency is not available to them. The subset below is what a workflow file
// actually uses: block mappings, 2-space-ish indentation, inline scalars, flow
// sequences on one line, and block scalars for `run:`. Anything it cannot read
// is reported by its caller (`unparsed-workflow`, an empty job map) rather than
// passing quietly — a reader that returns "nothing here" for a file it did not
// understand is how a gate goes silent.
//
// TWO INDEX SPACES, on purpose:
//   * `significantLines` + `keysAt`/`listAt` — comments and blanks stripped, so
//     structure walks cleanly. Indices are into THAT array; they are not line
//     numbers and must never be reported as such.
//   * the `*In(text)` readers — raw lines, 1-based line numbers preserved,
//     because their callers point a human at a file:line.

/** Columns of leading whitespace. */
export const indentOf = (line) => line.length - line.trimStart().length;

/** Strip one layer of matching-ish quotes from a scalar. */
export const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');

/** The line ending the file already uses — a rewrite must not change it. */
export const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Raw lines, CRLF-tolerant. Index i is line i+1. */
export const rawLines = (text) => text.split(/\r?\n/);

/** Lines that carry structure: no blanks, no whole-line comments. */
export function significantLines(text) {
  return rawLines(text).filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
}

/** Collect `key:` entries at exactly `indent`, inside the block starting after `from`. */
export function keysAt(lines, from, indent) {
  const out = [];
  for (let i = from; i < lines.length; i++) {
    const ind = indentOf(lines[i]);
    if (ind < indent && lines[i].trim() !== '') break;
    if (ind !== indent) continue;
    const m = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(lines[i].trim());
    if (m) out.push({ key: m[1], value: m[2], index: i });
  }
  return out;
}

/** Collect `- item` entries at exactly `indent` inside the block after `from`. */
export function listAt(lines, from, indent) {
  const out = [];
  for (let i = from; i < lines.length; i++) {
    const ind = indentOf(lines[i]);
    if (ind < indent) break;
    if (ind === indent && lines[i].trim().startsWith('- ')) out.push(unquote(lines[i].trim().slice(2)));
  }
  return out;
}

/** `uses:` in either the step-item (`- uses: x`) or the continuation form. */
export const USES_RE = /^\s*(?:-\s*)?uses:\s*(['"]?)([^'"\s#]+)\1/;

/** Every `uses:` in a workflow, with its 1-based line number. */
export function usesIn(text) {
  const out = [];
  rawLines(text).forEach((line, i) => {
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
 * The top-level `on:` keys. Handles `on: push`, `on: [a, b]`, `"on":` and the
 * block form, at whatever indent the block happens to use.
 */
export function triggersIn(text) {
  const lines = rawLines(text);
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
      const lead = indentOf(lines[j]);
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

/**
 * `{ <jobId>: { <scope>: <level> } | 'read-all' | null }` — the job-level
 * `permissions:` block of every job, or `null` for a job that declares none and
 * therefore inherits the workflow's.
 *
 * WHY A READER AND NOT A BOOLEAN: `hasTopLevelPermissions` answers "is the token
 * scoped at all", which is the question that catches a NEW workflow. It cannot
 * answer the one that matters for a workflow already handling untrusted content
 * — *how much* can a hostile input reach. A scope is widened by adding one line,
 * in a file most reviewers skim; naming the expected set in a fixture is what
 * turns that into a deliberate act.
 */
export function jobPermissions(text) {
  const lines = rawLines(text);
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
    const lead = indentOf(line);
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
      if (indentOf(lines[j]) <= keyIndent) break;
      const kv = /^\s*([a-z][a-z-]*):[ \t]*([A-Za-z-]+)/.exec(lines[j]);
      if (kv) scopes[kv[1]] = kv[2];
    }
  }
  close();
  return out;
}

/**
 * Every line of every `<key>:` script, with its 1-based line number. Both forms
 * matter: the inline one (`- run: npm ci`) and the block scalar (`run: |`),
 * which is where the multi-line shell that actually gets exploited lives.
 *
 * Indentation-driven rather than parsed, for the same reason as the rest of this
 * file — "which lines end up inside a script" survives being read line by line.
 */
export function blockScalarLines(text, key = 'run') {
  const lines = rawLines(text);
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
      if (indentOf(lines[j]) <= indent) break;
      out.push({ line: j + 1, text: lines[j] });
    }
    i = j;
  }
  return out;
}

/**
 * `[{ line, inputs }]` — every `actions/checkout` step, with the `with:` inputs it
 * was given as `{ <key>: { value, line } }`.
 *
 * Only keys under `with:` are read. The step's `env:` block can carry a key called
 * `token` that is not the action's input at all, and a reader that conflated the
 * two would either miss a real `token:` or invent one.
 */
export function checkoutSteps(text) {
  const lines = rawLines(text);
  const out = [];
  let step = null; // the checkout step being read, or null
  let withCol = null; // indentation of the `with:` key, once we are inside one
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    if (/^\s*-\s/.test(line)) {
      step = null; // a new step begins
      withCol = null;
    }
    const u = USES_RE.exec(line);
    if (u) {
      if (/(?:^|\/)checkout@/.test(u[2])) {
        step = { line: i + 1, inputs: {} };
        out.push(step);
      }
      continue;
    }
    if (!step) continue;
    const w = /^(\s*)with:[ \t]*(#.*)?$/.exec(line);
    if (w) {
      withCol = w[1].length;
      continue;
    }
    if (withCol === null) continue;
    if (indentOf(line) <= withCol) {
      withCol = null; // back out to a sibling key of `with:`
      continue;
    }
    const kv = /^\s*([A-Za-z_][\w-]*):[ \t]*(.*?)\s*$/.exec(line);
    if (kv) step.inputs[kv[1]] = { value: kv[2].replace(/\s+#.*$/, '').trim(), line: i + 1 };
  }
  return out;
}

/**
 * The structural summary the ruleset gate needs: what triggers this workflow,
 * what its jobs are called, and whether the token is scoped.
 *
 * @returns {{name: string|null, triggers: string[], permissions: boolean, jobs: Array}}
 */
export function parseWorkflow(text) {
  const lines = significantLines(text);
  const wf = { name: null, triggers: triggersIn(text), permissions: hasTopLevelPermissions(text), jobs: [] };

  for (const { key, value, index } of keysAt(lines, 0, 0)) {
    if (key === 'name') wf.name = unquote(value);
    else if (key === 'jobs') {
      for (const job of keysAt(lines, index + 1, 2)) {
        const body = keysAt(lines, job.index + 1, 4);
        const nameEntry = body.find((b) => b.key === 'name');
        const strategy = body.find((b) => b.key === 'strategy');
        const matrix = {};
        if (strategy) {
          const mx = keysAt(lines, strategy.index + 1, 6).find((b) => b.key === 'matrix');
          if (mx) for (const dim of keysAt(lines, mx.index + 1, 8)) matrix[dim.key] = listAt(lines, dim.index + 1, 10);
        }
        wf.jobs.push({
          id: job.key,
          name: nameEntry ? unquote(nameEntry.value) : job.key,
          permissions: body.some((b) => b.key === 'permissions'),
          matrix,
        });
      }
    }
  }
  return wf;
}
