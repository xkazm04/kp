#!/usr/bin/env node
// Does the gate still hold the thing it claims to hold?
//
// THE GAP THIS CLOSES: `review.yml` runs both review lenses and goes red on a
// blocking finding — but a red workflow is a NOTIFICATION. Only a required status
// check stops a merge, and that setting used to live in repository settings,
// outside this tree. From the outside, a review that gates every change and a
// review that ran once look identical: same workflow file, same green check.
//
// `.github/rulesets/main.json` now holds that configuration as a file. This
// script is what keeps the file honest, in two halves:
//
//   OFFLINE (default). No key, no network, no deps. Reads the ruleset and every
//     workflow, and asserts each required check CONTEXT still resolves to a job
//     that actually runs on a pull request. This is the drift that would
//     otherwise be silent: rename `Agent review (judgement)` and the ruleset goes
//     on requiring a check name nothing reports — the PR waits forever, someone
//     removes the requirement to unblock it, and the lens is no longer a gate.
//     Runs in CI on every push and PR. BLOCKS.
//
//   ONLINE (--verify). Asks GitHub whether the ruleset is really enforced on the
//     repository. Needs GH_TOKEN with `administration` scope. Without one it
//     prints THE LIVE HALF DID NOT RUN and exits 0 — the same rule agent-review
//     follows: a green check that silently means "not checked" is worse than a
//     red one. WITH a token it is not polite: an unenforced or missing ruleset
//     exits 1.
//
//   --apply    create or update the ruleset from the file (same token).
//
// USAGE
//   npm run review:gate
//   node scripts/review/gate-check.mjs --verify --repo xkazm04/kp
//   node scripts/review/gate-check.mjs --json
//
// EXIT CODES: 0 clean (or the live half was unavailable) · 1 a blocking finding.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './diff.mjs';
import { parseWorkflow } from './workflow-yaml.mjs';

export const RULESET_PATH = '.github/rulesets/main.json';
export const WORKFLOW_DIR = '.github/workflows';

// The two lenses. Everything else in the required set is ordinary CI; these two
// are the reason the ruleset exists, so their absence is called out by name
// rather than left to the reader to notice in a list of eleven.
export const REVIEW_CONTEXTS = ['Constitution (deterministic, blocking)', 'Agent review (judgement)'];

// The workflow reader lives in ./workflow-yaml.mjs — ONE reader, shared with
// scripts/security/check-actions.mjs. Re-exported here because this module is
// the gate's public surface and its fixtures import `parseWorkflow` from it.
export { parseWorkflow };

/**
 * The check names a job actually reports. A matrix job reports one per
 * combination of the dimensions its name interpolates — `CodeQL (${{ matrix.language }})`
 * is two checks, and a ruleset that requires the un-expanded string would block
 * every PR on a check that never arrives.
 */
export function checkNamesFor(job) {
  const re = /\$\{\{\s*matrix\.([\w.-]+)\s*\}\}/g;
  let names = [job.name];
  for (const m of job.name.matchAll(re)) {
    const values = job.matrix[m[1]];
    if (!values?.length) return { names: [job.name], unresolved: true };
    names = names.flatMap((n) => values.map((v) => n.replace(m[0], v)));
  }
  return { names, unresolved: /\$\{\{/.test(job.name) && names.length === 1 && names[0] === job.name };
}

export function loadWorkflows(root = REPO_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ file: `${WORKFLOW_DIR}/${f}`, ...parseWorkflow(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

export function requiredContexts(ruleset) {
  const rule = ruleset?.rules?.find((r) => r.type === 'required_status_checks');
  return rule?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
}

const finding = (severity, rule, message, fix) => ({ severity, rule, message, fix });

/**
 * Pure. `workflows` is loadWorkflows() output; `ruleset` is the parsed JSON.
 */
export function runChecks(ruleset, workflows) {
  const out = [];

  if (ruleset?.enforcement !== 'active') {
    out.push(
      finding(
        'blocking',
        'ruleset-inactive',
        `${RULESET_PATH} has enforcement "${ruleset?.enforcement}", not "active".`,
        'An "evaluate" ruleset reports and lets the merge through. That is a dry run, not a gate.',
      ),
    );
  }

  const required = requiredContexts(ruleset);
  if (required.length === 0) {
    out.push(
      finding(
        'blocking',
        'no-required-checks',
        `${RULESET_PATH} has no required_status_checks rule.`,
        'Without one, every workflow in this repository is a notification a merge can ignore.',
      ),
    );
  }

  // context -> the workflows that can report it, and on which triggers
  const produced = new Map();
  for (const wf of workflows) {
    if (wf.jobs.length === 0) {
      out.push(
        finding(
          'blocking',
          'unparsed-workflow',
          `${wf.file} declares no jobs.`,
          'Either it is a stub that reports a green check having done nothing, or this reader could not ' +
            'follow its indentation. Both need a human — a workflow nobody can read is not a gate.',
        ),
      );
      continue;
    }
    for (const job of wf.jobs) {
      const { names, unresolved } = checkNamesFor(job);
      if (unresolved) {
        out.push(
          finding(
            'warn',
            'unresolved-check-name',
            `${wf.file}: job "${job.id}" interpolates an expression this reader cannot expand ("${job.name}").`,
            'Its real check name cannot be predicted here, so it cannot be verified against the ruleset.',
          ),
        );
      }
      for (const n of names) {
        if (!produced.has(n)) produced.set(n, []);
        produced.get(n).push(wf);
      }
    }
  }

  for (const context of required) {
    const sources = produced.get(context);
    if (!sources) {
      out.push(
        finding(
          'blocking',
          'unknown-check',
          `The ruleset requires "${context}", which no job in ${WORKFLOW_DIR}/ reports.`,
          'A required check that never arrives blocks every pull request until someone removes the ' +
            'requirement to unblock one — which is how a gate quietly stops being one. Rename it back, ' +
            `or update ${RULESET_PATH} in the same change.`,
        ),
      );
      continue;
    }
    if (!sources.some((wf) => wf.triggers.includes('pull_request'))) {
      out.push(
        finding(
          'blocking',
          'not-on-pull-request',
          `"${context}" is required, but ${sources.map((s) => s.file).join(', ')} does not trigger on pull_request.`,
          'It can never report on a PR, so it can never be satisfied.',
        ),
      );
    }
  }

  for (const context of REVIEW_CONTEXTS) {
    if (!required.includes(context)) {
      out.push(
        finding(
          'blocking',
          'review-not-required',
          `"${context}" is not in the ruleset's required checks.`,
          'This is one of the two review lenses. If it does not gate the merge, the review is advice — ' +
            'see docs/development/change-review.md.',
        ),
      );
    }
  }

  // Everything that CAN report on a PR but is not required. Not an error — some
  // jobs are genuinely informational — but adding a gate and forgetting to
  // require it is the common way a new check ends up decorative, so it is said
  // out loud rather than left to be noticed.
  for (const [context, sources] of produced) {
    if (required.includes(context)) continue;
    if (!sources.some((wf) => wf.triggers.includes('pull_request'))) continue;
    out.push(
      finding(
        'warn',
        'ungated-job',
        `"${context}" runs on pull requests but is not a required check.`,
        `Add it to ${RULESET_PATH} if it should stop a merge; leave it if it is informational.`,
      ),
    );
  }

  return out;
}

// --- the online half ---------------------------------------------------------

const API = 'https://api.github.com';

function apiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'kp-gate-check',
  };
}

/** @returns {{ran: boolean, why?: string, findings?: object[]}} */
export async function verifyLive(ruleset, { repo, token, fetchImpl = fetch } = {}) {
  if (!token) return { ran: false, why: 'no GH_TOKEN / GITHUB_TOKEN in the environment' };
  if (!repo) return { ran: false, why: 'no repository (pass --repo owner/name or set GITHUB_REPOSITORY)' };

  let list;
  try {
    const res = await fetchImpl(`${API}/repos/${repo}/rulesets?includes_parents=false`, { headers: apiHeaders(token) });
    if (!res.ok) return { ran: false, why: `GET /repos/${repo}/rulesets returned ${res.status}` };
    list = await res.json();
  } catch (err) {
    return { ran: false, why: `the rulesets API was unreachable (${err.message})` };
  }

  const match = list.find((r) => r.name === ruleset.name) ?? list.find((r) => r.target === 'branch');
  if (!match) {
    return {
      ran: true,
      findings: [
        finding(
          'blocking',
          'ruleset-not-applied',
          `${repo} has no branch ruleset. ${RULESET_PATH} is a file nobody applied.`,
          'Run `npm run review:gate -- --apply` with an admin token.',
        ),
      ],
    };
  }

  let live;
  try {
    const res = await fetchImpl(`${API}/repos/${repo}/rulesets/${match.id}`, { headers: apiHeaders(token) });
    if (!res.ok) return { ran: false, why: `GET /repos/${repo}/rulesets/${match.id} returned ${res.status}` };
    live = await res.json();
  } catch (err) {
    return { ran: false, why: `the rulesets API was unreachable (${err.message})` };
  }

  const out = [];
  if (live.enforcement !== 'active') {
    out.push(
      finding(
        'blocking',
        'live-ruleset-inactive',
        `The applied ruleset "${live.name}" has enforcement "${live.enforcement}".`,
        'It reports and lets merges through. Re-apply with --apply.',
      ),
    );
  }
  const liveContexts = new Set(requiredContexts(live));
  for (const context of requiredContexts(ruleset)) {
    if (!liveContexts.has(context)) {
      out.push(
        finding(
          'blocking',
          'live-check-not-required',
          `"${context}" is required by ${RULESET_PATH} but not by the applied ruleset.`,
          'The tree and the repository disagree about what gates a merge. Re-apply with --apply.',
        ),
      );
    }
  }
  return { ran: true, findings: out };
}

export async function applyLive(ruleset, { repo, token, fetchImpl = fetch } = {}) {
  if (!token || !repo) throw new Error('--apply needs GH_TOKEN and a repository');
  const listRes = await fetchImpl(`${API}/repos/${repo}/rulesets`, { headers: apiHeaders(token) });
  if (!listRes.ok) throw new Error(`GET /repos/${repo}/rulesets returned ${listRes.status}`);
  const existing = (await listRes.json()).find((r) => r.name === ruleset.name);
  const res = await fetchImpl(`${API}/repos/${repo}/rulesets${existing ? `/${existing.id}` : ''}`, {
    method: existing ? 'PUT' : 'POST',
    headers: { ...apiHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(ruleset),
  });
  if (!res.ok) throw new Error(`${existing ? 'PUT' : 'POST'} ruleset returned ${res.status}: ${await res.text()}`);
  return existing ? 'updated' : 'created';
}

// --- CLI ---------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { verify: false, apply: false, json: false, repo: process.env.GITHUB_REPOSITORY ?? null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--verify') args.verify = true;
    else if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--repo') args.repo = argv[++i];
  }
  return args;
}

export function render(findings) {
  if (findings.length === 0) return 'gate-check: the ruleset and the workflows agree.';
  const lines = [];
  for (const f of findings) {
    lines.push(`${f.severity === 'blocking' ? 'BLOCK' : ' note'}  [${f.rule}] ${f.message}`);
    lines.push(`        ${f.fix}`);
  }
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  lines.push('');
  lines.push(`${blocking} blocking, ${findings.length - blocking} note(s).`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rulesetFile = path.join(REPO_ROOT, RULESET_PATH);
  if (!fs.existsSync(rulesetFile)) {
    console.error(`gate-check: ${RULESET_PATH} is missing — the gate has no configuration in this tree.`);
    process.exit(1);
  }
  const ruleset = JSON.parse(fs.readFileSync(rulesetFile, 'utf8'));
  const findings = runChecks(ruleset, loadWorkflows());

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;

  if (args.apply) {
    const what = await applyLive(ruleset, { repo: args.repo, token });
    console.log(`gate-check: ruleset ${what} on ${args.repo}.`);
  }

  let live = null;
  if (args.verify) {
    live = await verifyLive(ruleset, { repo: args.repo, token });
    if (!live.ran) {
      // Loud, and exit 0 — see the header. The offline half above still gates.
      console.log('');
      console.log('  THE LIVE HALF DID NOT RUN');
      console.log(`  ${live.why}.`);
      console.log('  Nothing here checked that the ruleset is actually enforced on the repository.');
      console.log('');
    } else {
      findings.push(...live.findings);
    }
  }

  if (args.json) console.log(JSON.stringify({ findings, liveVerified: live?.ran ?? false }, null, 2));
  else console.log(render(findings));

  process.exit(findings.some((f) => f.severity === 'blocking') ? 1 : 0);
}

if (process.argv[1]?.endsWith('gate-check.mjs')) {
  main().catch((err) => {
    console.error(`gate-check: ${err.message}`);
    process.exit(1);
  });
}
