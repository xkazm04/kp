#!/usr/bin/env node
// ONE guidance file is canonical, and the manifest says which.
//
// THE GAP THIS CLOSES: this repository ships three agent-guidance files, and
// they do agree — `AGENTS.md` says in prose that the full guide is
// `.claude/CLAUDE.md`, and `CLAUDE.md` reaches it by `@AGENTS.md`. That works
// for a human. A tool resolving the contract from `.ai/manifest.yaml` had
// nothing to read, so it had to guess which of the three to load first, and
// guessing is the one thing a manifest exists to prevent. Worse, `CLAUDE.md`'s
// route is two hops through an `@include` — a reader that does not expand
// includes lands on the shortest of the three files and never learns the rules.
//
// `guidance:` in `.ai/manifest.yaml` is now that declaration. This check is what
// stops it from becoming a claim nobody verifies — the same reason ADRs have
// `docs:check` rather than a promise to keep them current.
//
// WHAT IT ENFORCES
//
//   canonical-missing     `guidance.canonical` is absent, or names a file that
//                         is not there.
//   projection-undeclared a guidance file exists on disk (CLAUDE.md, AGENTS.md,
//                         .claude/CLAUDE.md, GEMINI.md, copilot-instructions…)
//                         and the manifest neither calls it canonical nor lists
//                         it as a projection. A fourth guidance file that nobody
//                         declared is exactly how three files become four
//                         opinions.
//   projection-missing    a declared projection does not exist.
//   projection-not-pointing  a projection never names the canonical file, so a
//                         reader that starts there has no way to reach it. An
//                         `@include` counts — naming the path is the whole test.
//   dangling-command      a guidance file tells an agent to run `npm run <x>`
//                         and package.json does not define `<x>`. The same drift
//                         shape `hooks:check` catches: instructions that read
//                         fine and no longer connect to anything.
//   verify-undeclared     `guidance.verify` is absent or empty. It is the list of
//                         commands that verify a change, and it is what turns the
//                         two rules below from opinions into a comparison.
//   verify-command-dangling  `guidance.verify` names an npm script package.json
//                         does not define — the first half of a rename.
//   verify-command-missing   a declared guidance file (canonical OR projection)
//                         never names a verify command. THIS IS THE RULE THIS
//                         SCRIPT WAS MISSING. Every rule above reads one file at
//                         a time, so the drift that actually bites is invisible
//                         to all of them: rename `test:unit` in `.claude/CLAUDE.md`,
//                         land the new name in package.json, and AGENTS.md goes
//                         on telling an agent to run the old one while both files
//                         stay internally consistent. They do not disagree about
//                         anything a per-file rule can see — they just answer
//                         "how do I verify a change" differently, and whichever
//                         file the agent opened decides which answer it gets.
//                         An `@include` counts: a projection whose only route to
//                         the command is an include is read the way a tool that
//                         expands includes reads it (see `resolveIncludes`).
//
// AND THE RULE ABOVE IS STILL NOT FIDELITY. `verify` is the SHORT list — three
// commands, the ones an agent runs before it says it is done. "Will this change
// land green" is a different question, and until the four rules below existed
// nothing asked it: ci.yml's node-quality job runs two dozen npm scripts, three
// of them are the verify set, and an agent that ran those three and pushed found
// out about design:check, docs:check, release:check and the rest from a red
// build. The commands were documented; nobody had checked that the documented
// commands were the ones that gate.
//
//   gates-undeclared      `guidance.gates` is absent or empty — the declaration
//                         the four rules below compare against.
//   gate-command-dangling a declared gate package.json does not define.
//   gate-unlisted         a GATING WORKFLOW (ci.yml or review.yml) runs
//                         `npm run <x>` and the manifest does not declare it. A
//                         step added to CI that the guidance never mentions is
//                         the drift itself. A step that invokes the script file
//                         directly (`node scripts/review/constitution-check.mjs`,
//                         which is how review.yml runs both lenses) counts: it is
//                         resolved back to the npm script that wraps it, because
//                         a gate that skips `npm run` is still a gate.
//   gate-stale            the manifest declares a gate no gating workflow runs,
//                         so the list has become a copy nobody re-read.
//   gates-doc-missing     `guidance.gates_doc` is absent, names a file that is
//                         not there, or names one the manifest does not otherwise
//                         declare as guidance. It is the ONE file that carries the
//                         gate table, named explicitly rather than assumed, so
//                         moving the table is a one-line manifest edit instead of
//                         a rule rewrite.
//   gate-undocumented     a declared gate `guidance.gates_doc` never names. ONE
//                         file has to carry it, not all of them: `verify` is the
//                         short list every projection must repeat, and applying
//                         that to two dozen gates would make each projection a
//                         copy of the pipeline and guarantee they drift.
//
// The gate rules run only when the caller supplies the workflow's commands. A
// check that invents its own evidence is worse than one that says it did not run.
//
//   npm run guidance:check
//
// EXIT CODES: 0 clean · 1 any finding.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_PATH = '.ai/manifest.yaml';
/** The workflow the gate rules read. Its `run:` steps ARE the definition of "green". */
export const CI_WORKFLOW = '.github/workflows/ci.yml';
/**
 * …and it is not the only one. `.github/workflows/review.yml` runs the two review
 * lenses on every PR and every push to main, and `.githooks/pre-push` runs them
 * before a push to main — they gate a change exactly as ci.yml's steps do, and
 * until this list existed neither had a row in the gate table or an entry in the
 * manifest, so `guidance:check` reconciled nothing about them.
 *
 * A gate is an npm script a GATING WORKFLOW runs, however it invokes it: review.yml
 * calls `node scripts/review/constitution-check.mjs` directly rather than through
 * `npm run review:constitution`, and reading only `npm run` would have declared the
 * lens undocumented forever. See `nodeScriptIndex`.
 */
export const GATE_WORKFLOWS = [CI_WORKFLOW, '.github/workflows/review.yml'];
const GATE_WORKFLOWS_LABEL = GATE_WORKFLOWS.join(' / ');

/**
 * Where agent guidance is conventionally found. A file here that the manifest
 * does not account for is a finding, not an omission to shrug at: the point of
 * the declaration is that a tool never has to rank these itself.
 */
export const GUIDANCE_CANDIDATES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.claude/CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
];

const scalar = (v) => v.replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '');

/**
 * The `guidance:` block, read without a YAML dependency — these scripts run in
 * CI jobs that deliberately never `npm ci`. Returns null when the key is absent,
 * which is itself a finding rather than a reason to pass.
 */
export function parseGuidance(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^guidance:\s*(#.*)?$/.test(l));
  if (start === -1) return null;

  let canonical = null;
  let gatesDoc = null;
  const projections = [];
  const verify = [];
  const gates = [];
  let key = null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    if (!/^\s/.test(line)) break; // back at column 0 — the next top-level key

    const pair = /^\s{2}([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      key = pair[1];
      if (key === 'canonical' && pair[2].trim()) canonical = scalar(pair[2]);
      else if (key === 'gates_doc' && pair[2].trim()) gatesDoc = scalar(pair[2]);
      continue;
    }
    const item = /^\s{4,}-\s*(.+)$/.exec(line);
    if (!item) continue;
    if (key === 'projections') projections.push(scalar(item[1]));
    else if (key === 'verify') verify.push(scalar(item[1]));
    else if (key === 'gates') gates.push(scalar(item[1]));
  }
  return { canonical, projections, verify, gates, gatesDoc };
}

/**
 * Every `npm run <script>` a GitHub Actions workflow actually runs.
 *
 * Reads `run:` step values only — inline (`run: npm run lint`) and block scalars
 * (`run: |`, `run: >-`), with the block's extent taken from the column of the
 * `run:` key itself so a sibling `env:` never reads as part of the script. The
 * naive alternative — grep the file for `npm run` — would pick up every command
 * NAMED IN A COMMENT, and this workflow's comments name half a dozen scripts it
 * deliberately does not run (`test:e2e`, `bench:gate`, `ci:budget -- --tighten`).
 * A gate list seeded from those would be fiction.
 *
 * Shell comments inside a block scalar are skipped for the same reason.
 */
export function nodeScriptIndex(scripts = {}) {
  const index = new Map();
  for (const name of Object.keys(scripts).sort()) {
    for (const m of String(scripts[name]).matchAll(/node\s+((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js))/g)) {
      const p = m[1].replace(/^\.\//, '');
      if (!index.has(p)) index.set(p, name);
    }
  }
  return index;
}

export function ciCommands(yaml, scripts = null) {
  const lines = String(yaml ?? '').split(/\r?\n/);
  const found = new Set();
  // A workflow that runs the script FILE is running the gate. Without this, a
  // step invoking `node scripts/review/constitution-check.mjs` reads as no gate
  // at all, and the row it owes the table never becomes a finding.
  const byFile = scripts ? nodeScriptIndex(scripts) : null;
  const scan = (s) => {
    for (const m of s.matchAll(/npm run ([\w:-]+)/g)) found.add(m[1]);
    if (!byFile) return;
    for (const m of s.matchAll(/node\s+((?:\.\/)?[\w./-]+\.(?:mjs|cjs|js))/g)) {
      const name = byFile.get(m[1].replace(/^\.\//, ''));
      if (name) found.add(name);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!m) continue;

    const rest = m[1].trim();
    if (!/^[|>][+-]?\d*$/.test(rest)) {
      scan(rest); // an inline command, or an empty value with nothing to read
      continue;
    }

    const keyCol = line.indexOf('run:');
    let j = i + 1;
    for (; j < lines.length; j++) {
      const body = lines[j];
      if (body.trim() === '') continue;
      if (body.length - body.trimStart().length <= keyCol) break; // back at a sibling key
      if (body.trimStart().startsWith('#')) continue;
      scan(body);
    }
    i = j - 1;
  }
  return [...found].sort();
}

/**
 * `@path/to/file.md` on its own line is an include — Claude Code expands it, and
 * this repository's root `CLAUDE.md` reaches every rule in the canonical file
 * through exactly one. A check that read the raw text would report that file as
 * naming no commands at all, which is true of the bytes and false of what an
 * agent sees.
 *
 * Recursive but cycle-guarded, and anything it cannot resolve — a target that is
 * missing, a directory, a path that climbs out of the tree — is LEFT AS THE LINE
 * IT WAS. A missing include is `projection-missing`'s business; this function's
 * only job is that it must never throw in the middle of a check.
 */
export function resolveIncludes(text, root = REPO_ROOT, seen = new Set()) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = /^@([\w./-]+)\s*$/.exec(line.trim());
      if (!m || seen.has(m[1])) return line;
      const target = path.resolve(root, m[1]);
      if (path.relative(root, target).startsWith('..')) return line; // outside the tree
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return line;
      return resolveIncludes(fs.readFileSync(target, 'utf8'), root, new Set([...seen, m[1]]));
    })
    .join('\n');
}

/** Every `npm run <script>` a guidance file tells an agent to run. */
export function commandsIn(source) {
  return [...new Set([...source.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]))];
}

const finding = (rule, message, fix) => ({ rule, message, fix });

/**
 * Pure. `guidance` is the parsed block, `files` is `[{path, text, expanded?}]`
 * for every guidance candidate that EXISTS (`expanded` is `text` with `@includes`
 * resolved; absent means the two are the same), `scripts` is package.json's
 * scripts object, and `ci` is the npm scripts .github/workflows/ci.yml runs
 * (`ciCommands()` above). `ci = null` means the caller did not read the workflow,
 * and the gate rules DO NOT RUN rather than guessing.
 */
export function runChecks(guidance, files, scripts, ci = null) {
  const out = [];
  const canonical = guidance?.canonical ?? null;
  const declared = new Set([canonical, ...(guidance?.projections ?? [])].filter(Boolean));

  if (!canonical) {
    out.push(
      finding(
        'canonical-missing',
        `${MANIFEST_PATH} declares no \`guidance.canonical\`.`,
        'Add it. A tool reading the manifest otherwise has to guess which guidance file to load first, ' +
          'and the three in this repo are not interchangeable.',
      ),
    );
  } else if (!files.some((f) => f.path === canonical)) {
    out.push(
      finding(
        'canonical-missing',
        `\`guidance.canonical\` names ${canonical}, which does not exist.`,
        'Point it at the file that replaced it. A manifest that names a moved file is worse than one that names none.',
      ),
    );
  }

  for (const f of files) {
    if (!declared.has(f.path)) {
      out.push(
        finding(
          'projection-undeclared',
          `${f.path} is agent guidance the manifest does not mention.`,
          `Add it under \`guidance.projections\` in ${MANIFEST_PATH}, or delete it. An undeclared guidance file ` +
            'is a second opinion a tool may load instead of the canonical one.',
        ),
      );
    }
  }

  for (const declaredPath of guidance?.projections ?? []) {
    const file = files.find((f) => f.path === declaredPath);
    if (!file) {
      out.push(
        finding(
          'projection-missing',
          `\`guidance.projections\` lists ${declaredPath}, which does not exist.`,
          'Delete the entry, or restore the file.',
        ),
      );
      continue;
    }
    if (canonical && !file.text.includes(canonical)) {
      out.push(
        finding(
          'projection-not-pointing',
          `${declaredPath} never names ${canonical}.`,
          'A reader that starts at this file has no route to the canonical one. Name the path — an `@include` ' +
            'counts, since it contains the path; a description of it does not.',
        ),
      );
    }
  }

  for (const f of files) {
    for (const cmd of commandsIn(f.text)) {
      if (!(cmd in scripts)) {
        out.push(
          finding(
            'dangling-command',
            `${f.path} tells an agent to run \`npm run ${cmd}\`, which package.json no longer defines.`,
            'Point it at the new name. Until then the instruction reads as a gate and is a typo.',
          ),
        );
      }
    }
  }

  // THE COMMANDS THE THREE FILES ARE SUPPOSED TO AGREE ON.
  //
  // Everything above reads each guidance file on its own. None of it can see the
  // drift that actually bites: rename the verify command in the canonical file,
  // land the new name in package.json, and every rule so far stays green while
  // AGENTS.md goes on telling an agent to run the old one. Both files are
  // internally consistent; they just answer "how do I verify a change"
  // differently, and whichever one the agent opened decides which answer it gets.
  //
  // `guidance.verify` in the manifest is the shared answer. A projection may say
  // LESS than the file it projects about anything else — that is what makes it a
  // projection — but these it must carry, spelled the same way.
  const verify = guidance?.verify ?? [];
  if (verify.length === 0) {
    out.push(
      finding(
        'verify-undeclared',
        `${MANIFEST_PATH} declares no \`guidance.verify\`.`,
        'List the commands that verify a change here (typecheck, unit tests, lint). Without them this check ' +
          'can compare the guidance files for internal consistency and nothing else — which is the state in ' +
          'which they agreed by discipline rather than by a gate.',
      ),
    );
  }

  for (const cmd of verify) {
    if (!(cmd in scripts)) {
      out.push(
        finding(
          'verify-command-dangling',
          `\`guidance.verify\` lists \`npm run ${cmd}\`, which package.json does not define.`,
          'This is the first half of a rename: the manifest still names the command that went away. Update it ' +
            'to the new name — the rule below will then name every guidance file that has not caught up.',
        ),
      );
      continue;
    }
    for (const f of files) {
      if (!declared.has(f.path)) continue; // an undeclared file is already a finding
      if (commandsIn(f.expanded ?? f.text).includes(cmd)) continue;
      out.push(
        finding(
          'verify-command-missing',
          `${f.path} never names \`npm run ${cmd}\`, which ${MANIFEST_PATH} declares as a verify command.`,
          `An agent that opens ${f.path} does not learn to run it. Add the command there, or take it out of ` +
            '`guidance.verify` because it is no longer how a change is verified — one of those is true, and ' +
            'the manifest is where this repository says which. Do not fix it by deleting the entry unless the ' +
            'second one is what happened.',
        ),
      );
    }
  }

  // WHAT CI WILL ACTUALLY RUN — the difference between "my change works" and
  // "my change lands green".
  //
  // `verify` above is deliberately short: the three commands an agent runs
  // before it says it is done, and the only ones every projection must carry.
  // That is a consistency rule, and the three files passed it while ci.yml grew
  // to two dozen steps none of them named. An agent that read the canonical
  // document, ran typecheck/lint/test:unit and pushed learned about
  // design:check, docs:check, release:check and the rest from a red build.
  //
  // `guidance.gates` is the declared answer, compared IN BOTH DIRECTIONS against
  // the workflow so it cannot decay into a copy nobody re-reads: a step added to
  // ci.yml that nothing declares is `gate-unlisted`, an entry CI no longer runs
  // is `gate-stale`. ONE declared guidance file carries the table — named by
  // `guidance.gates_doc`, because two dozen gates repeated in three files is a
  // guarantee of drift, and which file it is should be a manifest line rather
  // than a rule this script hard-codes.
  if (ci !== null) {
    const gates = guidance?.gates ?? [];
    const gatesDoc = guidance?.gatesDoc ?? null;
    const gatesDocFile = gatesDoc ? files.find((f) => f.path === gatesDoc) : null;
    const namedByGatesDoc = gatesDocFile ? commandsIn(gatesDocFile.expanded ?? gatesDocFile.text) : [];

    if (!gatesDoc) {
      out.push(
        finding(
          'gates-doc-missing',
          `${MANIFEST_PATH} declares no \`guidance.gates_doc\`.`,
          'Name the ONE guidance file that carries the gate table. Without it, `gates` is a list in a manifest ' +
            'and no document an agent opens has to agree with it.',
        ),
      );
    } else if (!gatesDocFile) {
      out.push(
        finding(
          'gates-doc-missing',
          `\`guidance.gates_doc\` names ${gatesDoc}, which does not exist.`,
          'Point it at the file that replaced it.',
        ),
      );
    } else if (!declared.has(gatesDoc)) {
      out.push(
        finding(
          'gates-doc-missing',
          `\`guidance.gates_doc\` names ${gatesDoc}, which is not the canonical file or one of its projections.`,
          'The gate table belongs in guidance an agent is already told to read. Declare that file under ' +
            '`guidance.projections`, or move the table into one that is declared.',
        ),
      );
    }

    if (gates.length === 0) {
      out.push(
        finding(
          'gates-undeclared',
          `${MANIFEST_PATH} declares no \`guidance.gates\`.`,
          `List every npm script ${GATE_WORKFLOWS_LABEL} run here. Without it this check can prove the guidance files ` +
            'agree with each other and nothing about whether following them lands a green build — which is the ' +
            'state in which the documented commands and the gating commands were two different sets.',
        ),
      );
    }

    for (const cmd of gates) {
      if (!(cmd in scripts)) {
        out.push(
          finding(
            'gate-command-dangling',
            `\`guidance.gates\` lists \`npm run ${cmd}\`, which package.json does not define.`,
            'Update it to the new name, or drop it if the gate went away — the rule below will then name the ' +
              'workflow step that has not caught up.',
          ),
        );
        continue;
      }
      if (!ci.includes(cmd)) {
        out.push(
          finding(
            'gate-stale',
            `\`guidance.gates\` declares \`npm run ${cmd}\`, which ${GATE_WORKFLOWS_LABEL} do not run.`,
            `Remove it, or restore the step. A gate list that names a command CI dropped tells an agent to spend ` +
              'time on something nothing checks, which is how the list stops being read at all.',
          ),
        );
      }
      if (gatesDocFile && !namedByGatesDoc.includes(cmd)) {
        out.push(
          finding(
            'gate-undocumented',
            `${gatesDoc} never names \`npm run ${cmd}\`, which ${MANIFEST_PATH} declares as a CI gate.`,
            `An agent that reads the guidance does not learn that this runs on its push, so it finds out from a ` +
              'red build. Add a row to the gate table saying what it fails on.',
          ),
        );
      }
    }

    for (const cmd of ci) {
      if (gates.includes(cmd)) continue;
      out.push(
        finding(
          'gate-unlisted',
          `${GATE_WORKFLOWS_LABEL} run \`npm run ${cmd}\` and ${MANIFEST_PATH} does not declare it as a gate.`,
          `Add it to \`guidance.gates\` AND to the gate table in ${guidance?.gatesDoc ?? 'the declared gates doc'} ` +
            'in the same change. A step that gates every push and appears in no guidance is exactly the drift this ' +
            'rule exists for — an agent cannot run what it was never told about.',
        ),
      );
    }
  }

  return out;
}

/**
 * The conventional locations PLUS whatever the manifest declares — otherwise a
 * canonical file stored somewhere unconventional would read as missing, and the
 * check would be telling the repository to organise itself the way this list
 * happens to be written.
 */
export function loadGuidanceFiles(root = REPO_ROOT, declared = []) {
  return [...new Set([...GUIDANCE_CANDIDATES, ...declared.filter(Boolean)])]
    .filter((p) => fs.existsSync(path.join(root, p)))
    .map((p) => {
      const text = fs.readFileSync(path.join(root, p), 'utf8');
      // `text` is what the file says; `expanded` is what an agent reads. The
      // rules that judge THIS file (undeclared, not-pointing) use the first —
      // an include is not this file naming the canonical path. The verify
      // comparison uses the second, because a command reached through an
      // include is a command the agent gets.
      return { path: p, text, expanded: resolveIncludes(text, root, new Set([p])) };
    });
}

/** Every path the manifest names, canonical first. */
export const declaredPaths = (guidance) => [guidance?.canonical, ...(guidance?.projections ?? [])].filter(Boolean);

export function render(findings, guidance) {
  if (findings.length === 0) {
    return (
      `check-guidance: ${guidance.canonical} is canonical, ${guidance.projections.length} projection(s) point at it, ` +
      `every command they name exists, all ${guidance.verify?.length ?? 0} verify command(s) are named by every one of them, ` +
      `and all ${guidance.gates?.length ?? 0} CI gate(s) are declared, still run by ${GATE_WORKFLOWS_LABEL}, and named by ` +
      `${guidance.gatesDoc ?? 'the declared gates doc'}.`
    );
  }
  return [...findings.map((f) => `BLOCK  [${f.rule}] ${f.message}\n       ${f.fix}`), '', `${findings.length} finding(s).`].join('\n');
}

/**
 * The workflow's commands, or `[]` when it is not there. `[]` rather than `null`
 * on purpose: a missing ci.yml turns every declared gate into `gate-stale`, which
 * is loud, where "the gate rules did not run" would be silent.
 */
export function loadCiCommands(root = REPO_ROOT, scripts = null) {
  // package.json is read here rather than demanded from the caller so that a
  // one-argument call still resolves a direct `node scripts/…` invocation to the
  // npm script that wraps it — the alternative silently drops review.yml's lenses.
  let resolved = scripts;
  if (!resolved) {
    const pkgPath = path.join(root, 'package.json');
    resolved = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {} : {};
  }
  const found = new Set();
  for (const wf of GATE_WORKFLOWS) {
    const p = path.join(root, wf);
    if (!fs.existsSync(p)) continue;
    for (const cmd of ciCommands(fs.readFileSync(p, 'utf8'), resolved)) found.add(cmd);
  }
  return [...found].sort();
}

if (process.argv[1]?.endsWith('check-guidance.mjs')) {
  const manifest = fs.readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), 'utf8');
  const guidance = parseGuidance(manifest);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const findings = runChecks(
    guidance,
    loadGuidanceFiles(REPO_ROOT, declaredPaths(guidance)),
    pkg.scripts ?? {},
    loadCiCommands(REPO_ROOT),
  );
  console.log(render(findings, guidance ?? { canonical: null, projections: [], verify: [], gates: [], gatesDoc: null }));
  process.exit(findings.length === 0 ? 0 : 1);
}
