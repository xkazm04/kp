#!/usr/bin/env node
// Policy over the deployment shape. What the chart may never grant.
//
// THE GAP THIS CLOSES: the release path is signed, attested, version-checked and
// rehearsed in both directions (docs/architecture/releases.md), and the Helm
// chart it deploys is correct — one replica, an unprivileged uid, capabilities
// dropped, no secret in `values.yaml`. All of that is correct BY REVIEW. Nothing
// fails when a chart edit regresses it: `helm template` renders a privileged pod
// as happily as an unprivileged one, `helm lint` has no opinion about replica
// counts, and none of the seven CI workflows had ever read `deploy/`.
//
// Two of these are data-integrity rules rather than hardening preferences, and
// they are the reason this is a gate rather than a linter's default set:
//
//   * ONE REPLICA, `Recreate`. State is a single SQLite file on a ReadWriteOnce
//     volume. Two pods are two writers on one file — the failure is a corrupt
//     database, not a scaling limit, and `values.yaml` says `replicaCount` exists
//     "only for visibility" precisely because the template pins the real number.
//     A future edit that helpfully wires `replicas: {{ .Values.replicaCount }}`
//     back up would pass every generic policy in existence.
//   * THE ENV CONTRACT. Releases are defined partly in terms of environment
//     variables (releases.md), and the chart sets some of them. A key renamed on
//     one side of that contract is an upgrade break that shows up as a silently
//     missing setting on a running install — never as a failed deploy.
//
// EVERY RULE IS ANCHORED TO THE TREE. The values file is read for what it
// declares, AND the Deployment for whether it still applies it: a
// `securityContext` block nothing mounts is decoration, and checking only the
// values would call it hardened.
//
//   npm run deploy:check          # the gate
//   npm run test:deploy           # its fixtures
//
// WHERE IT RUNS: the `node-quality` job in .github/workflows/ci.yml, on every
// push and pull request. Dependency-free node:* — no helm binary, no `npm ci`,
// no cluster.
//
// CHANGING A POLICY is a deliberate edit to POLICIES below with the reason, which
// a reviewer can read and disagree with. Loosening a value in values.yaml until
// the check goes quiet is the failure mode this file exists to prevent.
//
// EXIT CODES: 0 clean · 1 any finding · 2 the chart could not be read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHART_DIR = 'deploy/helm/kp';
export const ENV_EXAMPLE = '.env.example';

/** The files the policies read. A missing one is exit 2, never a quiet pass. */
export const CHART_FILES = {
  values: `${CHART_DIR}/values.yaml`,
  deployment: `${CHART_DIR}/templates/deployment.yaml`,
  service: `${CHART_DIR}/templates/service.yaml`,
  configmap: `${CHART_DIR}/templates/configmap.yaml`,
  secret: `${CHART_DIR}/templates/secret.yaml`,
};

// --- reading YAML that is also a Go template ---------------------------------
//
// A real YAML parser is the wrong tool here and not just a heavy one: half of
// these files are `{{- if }}` / `{{- range }}` and do not parse until Helm has
// rendered them. These two helpers read what is being ASSERTED — a key's literal
// value, and the keys a block declares — which is all any policy below needs.

/** Strip a trailing `# comment` from a scalar value. */
const scalar = (v) => String(v).replace(/\s+#.*$/, '').trim();

/**
 * The indented body of a top-level `key:` block, or '' when there is none.
 * Ends at the first non-blank line back at column 0 — which is what makes
 * `blockOf(values, 'env')` stop at `extraEnv:` rather than swallowing the rest
 * of the file.
 */
export function blockOf(yaml, key) {
  const lines = String(yaml ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}:\\s*(#.*)?$`).test(l));
  if (start === -1) return '';
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (!/^\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * The literal value of the first `key:` at any depth of `text`, or null.
 *
 * "At any depth" is deliberate and is why `capabilities.drop` is reachable as
 * `valueOf(securityContextBlock, 'drop')`. It costs precision the policies here
 * do not need: each one is applied to a block it has already narrowed to.
 */
export function valueOf(text, key) {
  const m = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(String(text ?? ''));
  if (!m) return null;
  const v = scalar(m[1]);
  return v === '' ? '' : v.replace(/^['"]|['"]$/g, '');
}

/** True when `key:` appears anywhere in `text` (used for "is it wired at all"). */
export const hasKey = (text, key) => new RegExp(`^\\s*${key}:`, 'm').test(String(text ?? ''));

/** ENV_VAR-shaped keys a YAML block declares, ignoring comments and template lines. */
export function envKeysIn(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .map((l) => /^\s*([A-Z][A-Z0-9_]*):/.exec(l)?.[1])
        .filter(Boolean),
    ),
  ];
}

/** Every variable `.env.example` documents — commented-out lines included, since that file documents optional vars that way. */
export function documentedEnvKeys(text) {
  return new Set(
    String(text ?? '')
      .split(/\r?\n/)
      .map((l) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
      .filter(Boolean),
  );
}

/**
 * Env keys the chart pins that are NOT kp configuration and so have nothing to
 * document in .env.example. Kept tiny and justified: a growing exemption list is
 * how an env contract stops being a contract.
 */
export const ENV_CONTRACT_EXEMPT = new Map([
  ['NODE_ENV', 'a Node runtime convention, not a kp setting — the app never reads it as configuration'],
]);

/**
 * The OTHER direction of the env contract: keys the chart must GO ON setting.
 *
 * The forward rule ("a key the chart sets must be documented") only catches a
 * key being added. A key being REMOVED is the more expensive half and was
 * unchecked: dropping `KP_DB_PATH` from the ConfigMap does not fail a deploy, it
 * silently moves the database to a path derived from the launch directory —
 * inside the container's writable layer rather than on the mounted volume — and
 * the install comes up empty on its next restart. Nothing about that surfaces as
 * an error, which is exactly why it needs a gate rather than a review.
 */
export const ENV_CONTRACT_REQUIRED = new Map([
  [
    'KP_DB_PATH',
    'the database file. It must be the absolute path on the mounted volume: unset, app/_lib/db-path.ts ' +
      'derives one from the launch directory, so the pod opens a DIFFERENT, empty database inside its own ' +
      'container layer and loses every write on restart.',
  ],
  [
    'KP_OPERATOR_PASSWORD',
    'the login. Unset, kp runs OPEN — every operator route reachable with no session — and the chart would ' +
      'be deploying an unauthenticated recruiting database to a cluster.',
  ],
  [
    'KP_SECRET',
    'the key that encrypts stored provider keys at rest and signs sessions. Unset, saving a provider key is ' +
      'refused and every existing session is invalid.',
  ],
]);

/**
 * The secret keys whose absence must fail the INSTALL rather than render empty.
 *
 * `required` in the template is the whole guard: without it, `helm install` with
 * no `auth.operatorPassword` renders `KP_OPERATOR_PASSWORD: ""` and Kubernetes
 * happily starts an app with no login, green in every dashboard. Deleting one
 * `required` is a two-word edit that no other policy here notices — the key is
 * still set, still documented, still in the Secret.
 */
export const SECRET_REQUIRED_KEYS = new Map([
  ['KP_OPERATOR_PASSWORD', 'an empty operator password runs kp OPEN, with no login, on a cluster'],
  ['KP_SECRET', 'an empty secret means stored provider keys are not encrypted and sessions are not signed'],
]);

/** Literals that are a live credential rather than a placeholder. */
const CREDENTIAL_SHAPES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'an OpenAI-style key'],
  [/\bghp_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/\bAIza[A-Za-z0-9_-]{20,}/, 'a Google API key'],
  [/\bwhsec_[A-Za-z0-9]{16,}/, 'a webhook signing secret'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];

const finding = (rule, message, fix) => ({ rule, message, fix });

// --- the policies -------------------------------------------------------------
//
// Each entry is one property of the deployed shape that must not regress, with
// the reason it is here. `check` returns a message (a finding) or null.

export const POLICIES = [
  {
    rule: 'replicas-not-pinned',
    why: 'SQLite is one writer on a ReadWriteOnce volume; a second pod corrupts the database.',
    check: ({ deployment }) =>
      /^\s*replicas:\s*1\s*(#.*)?$/m.test(deployment)
        ? null
        : 'the Deployment does not pin `replicas: 1` as a literal. A templated replica count reintroduces the ' +
          'two-writers-one-file failure the chart exists to prevent — see docs/architecture/postgres-backend.md ' +
          'for what has to land before this can be relaxed.',
  },
  {
    rule: 'strategy-not-recreate',
    why: 'A rolling update runs two pods briefly, which is the same two-writer failure for the length of a deploy.',
    check: ({ deployment }) =>
      /strategy:\s*\r?\n\s*type:\s*Recreate\b/.test(deployment)
        ? null
        : 'the Deployment does not set `strategy: { type: Recreate }`. RollingUpdate overlaps the old and new pod ' +
          'on one RWO volume.',
  },
  {
    rule: 'security-context-not-applied',
    why: 'Values nothing mounts are decoration; the hardening rules below would then be checking a comment.',
    check: ({ deployment }) => {
      const missing = ['.Values.podSecurityContext', '.Values.securityContext'].filter((v) => !deployment.includes(v));
      return missing.length === 0
        ? null
        : `the Deployment no longer applies ${missing.join(' and ')}. The values can say anything once nothing ` +
          'reads them.';
    },
  },
  {
    rule: 'runs-as-root',
    why: 'The image writes only /data; nothing about kp needs uid 0.',
    check: ({ values }) => {
      const pod = blockOf(values, 'podSecurityContext');
      const nonRoot = valueOf(pod, 'runAsNonRoot');
      const uid = valueOf(pod, 'runAsUser');
      if (nonRoot !== 'true') return 'podSecurityContext.runAsNonRoot is not `true`.';
      if (uid === null || uid === '0') return `podSecurityContext.runAsUser is ${uid === null ? 'unset' : 'root (0)'}.`;
      return null;
    },
  },
  {
    rule: 'privilege-escalation-allowed',
    why: 'Nothing in the container needs to gain privileges it did not start with.',
    check: ({ values }) =>
      valueOf(blockOf(values, 'securityContext'), 'allowPrivilegeEscalation') === 'false'
        ? null
        : 'securityContext.allowPrivilegeEscalation is not `false`.',
  },
  {
    rule: 'capabilities-not-dropped',
    why: 'A Next server and a spawned Python process need no Linux capabilities at all.',
    check: ({ values }) => {
      const drop = valueOf(blockOf(values, 'securityContext'), 'drop');
      return drop && /\bALL\b/.test(drop) ? null : `securityContext.capabilities.drop does not drop ALL (found ${drop ?? 'nothing'}).`;
    },
  },
  {
    rule: 'privileged-pod',
    why: 'A privileged container, host namespace or host port is a different product than this chart deploys.',
    check: ({ deployment, service, configmap, secret }) => {
      const all = [deployment, service, configmap, secret].join('\n');
      const bad = ['privileged', 'hostNetwork', 'hostPID', 'hostIPC'].filter((k) =>
        new RegExp(`^\\s*${k}:\\s*true\\b`, 'm').test(all),
      );
      return bad.length === 0 ? null : `a template sets ${bad.join(', ')} to true.`;
    },
  },
  {
    rule: 'service-exposed-by-default',
    why: 'A default install should not put itself on a node port or ask a cloud for a public load balancer.',
    check: ({ values }) => {
      const type = valueOf(blockOf(values, 'service'), 'type');
      return type === 'ClusterIP'
        ? null
        : `service.type defaults to ${type ?? 'nothing'}, not ClusterIP. Expose kp through the chart's ingress ` +
          '(and its TLS) rather than by widening the default service.';
    },
  },
  {
    rule: 'secret-literal-in-values',
    why: 'values.yaml is the file people paste into tickets, commit to their infra repo and share.',
    check: ({ values }) => {
      const auth = blockOf(values, 'auth');
      const empty = (v) => v === '' || v === null;
      if (!empty(valueOf(auth, 'operatorPassword'))) return 'auth.operatorPassword ships with a value.';
      if (!empty(valueOf(auth, 'secret'))) return 'auth.secret ships with a value.';
      if ((valueOf(values, 'providerKeys') ?? '{}') !== '{}') return 'providerKeys ships with entries.';
      for (const [re, what] of CREDENTIAL_SHAPES) {
        if (re.test(values)) return `values.yaml contains ${what}.`;
      }
      return null;
    },
  },
  {
    rule: 'secret-renders-empty-instead-of-failing',
    why: 'A `required` deleted from the Secret template turns a failed install into an app with no login.',
    check: ({ secret }) => {
      const bad = [];
      for (const [key, consequence] of SECRET_REQUIRED_KEYS) {
        const line = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(secret)?.[1] ?? null;
        if (line === null) {
          bad.push(`${key} is no longer in the Secret template`);
        } else if (!/\brequired\s+"/.test(line)) {
          bad.push(`${key} is rendered without \`required\` — ${consequence}`);
        }
      }
      return bad.length === 0
        ? null
        : `${bad.join('; ')}. Wrap the value in \`required "<message a person can act on>"\` so the install ` +
          'fails loudly instead of deploying the open app.';
    },
  },
  {
    rule: 'open-mode-shipped-on',
    why: 'KP_ALLOW_OPEN is the one flag that turns the Secret template’s `required` guard into a formality.',
    check: ({ values, configmap, envExample }) => {
      // Truthy anywhere the chart sets env: a production build REFUSES to start
      // without an operator password unless this says the operator meant it, so
      // a chart that shipped it on would restore the exact state `required`
      // exists to prevent, one layer further down.
      const set = /^\s*(?:#\s*)?KP_ALLOW_OPEN:\s*["']?([^"'\s#]+)/m.exec(`${blockOf(values, 'env')}\n${configmap}`);
      const on = set && !/^\s*#/.test(set[0]) && !['0', 'false', '""', "''", ''].includes(set[1]);
      if (on) return `the chart sets KP_ALLOW_OPEN=${set[1]}, which lets a production build start with no login.`;
      // …and it has to be DOCUMENTED, because an operator who never learns the
      // flag exists reads the fail-closed refusal as a broken image.
      return documentedEnvKeys(envExample).has('KP_ALLOW_OPEN')
        ? null
        : `${ENV_EXAMPLE} does not document KP_ALLOW_OPEN. It is the escape hatch from the fail-closed ` +
          'production check, so it belongs next to KP_OPERATOR_PASSWORD with its default (off) stated.';
    },
  },
  {
    rule: 'no-memory-limit',
    why: 'The Python pipeline spawns subprocesses per request; an unbounded pod takes the node with it.',
    check: ({ values, deployment }) => {
      const res = blockOf(values, 'resources');
      if (!deployment.includes('.Values.resources')) return 'the Deployment does not apply .Values.resources.';
      return hasKey(res, 'limits') && hasKey(res, 'memory') ? null : 'resources declares no memory limit.';
    },
  },
  {
    rule: 'no-probes',
    why: 'Without a readiness probe, Recreate hands traffic to a pod that has not opened its database yet.',
    check: ({ values, deployment }) => {
      const missing = ['livenessProbe', 'readinessProbe'].filter(
        (p) => !hasKey(values, p) || !deployment.includes(`.Values.${p}`),
      );
      return missing.length === 0 ? null : `${missing.join(' and ')} is not both declared and applied.`;
    },
  },
  {
    rule: 'volume-access-mode-shared',
    why: 'ReadWriteMany would let the cluster schedule the second writer this chart spends two rules preventing.',
    check: ({ values }) => {
      const mode = valueOf(blockOf(values, 'persistence'), 'accessMode');
      return mode === 'ReadWriteOnce' ? null : `persistence.accessMode is ${mode ?? 'unset'}, not ReadWriteOnce.`;
    },
  },
];

/**
 * The env-var contract, in BOTH directions. Forward: every variable the chart
 * SETS must be one .env.example documents. Reverse: every variable in
 * ENV_CONTRACT_REQUIRED must still be one the chart sets.
 *
 * One direction was never a contract. A key added to the chart and not to
 * .env.example is undocumented configuration, which costs an operator an hour;
 * a key DROPPED from the chart is a setting that silently stopped applying,
 * which costs them the database. Separate from POLICIES because it reports per
 * key rather than per rule.
 */
export function checkEnvContract({ values, configmap, secret, envExample }) {
  const documented = documentedEnvKeys(envExample);
  const set = new Set([
    ...envKeysIn(blockOf(values, 'env')),
    ...envKeysIn(blockOf(configmap, 'data')),
    ...envKeysIn(blockOf(secret, 'stringData')),
  ]);

  const out = [];
  for (const key of [...set].sort()) {
    if (documented.has(key) || ENV_CONTRACT_EXEMPT.has(key)) continue;
    out.push(
      finding(
        'env-contract-drift',
        `the chart sets ${key}, which ${ENV_EXAMPLE} does not document.`,
        `Add ${key} to ${ENV_EXAMPLE} with what it does, or stop setting it. A release is defined partly by its ` +
          'environment contract (docs/architecture/releases.md); a key that exists on only one side of it is an ' +
          'upgrade break that surfaces as a setting that quietly stopped applying.',
      ),
    );
  }

  for (const [key, why] of ENV_CONTRACT_REQUIRED) {
    if (set.has(key)) continue;
    out.push(
      finding(
        'env-contract-dropped',
        `the chart no longer sets ${key}, which every install depends on.`,
        `Restore ${key} in the ConfigMap or the Secret template. ${why} If it genuinely moved elsewhere, ` +
          'move its entry out of ENV_CONTRACT_REQUIRED in the same change and say where it went — a ' +
          'required key with no enforcer is the half of this contract that was missing.',
      ),
    );
  }
  return out;
}

/** Pure. `chart` is `{values, deployment, service, configmap, secret, envExample}` of file TEXT. */
export function runPolicies(chart) {
  const out = [];
  for (const policy of POLICIES) {
    const message = policy.check(chart);
    if (message) out.push(finding(policy.rule, message, policy.why));
  }
  return [...out, ...checkEnvContract(chart)];
}

export function loadChart(root = REPO_ROOT) {
  const chart = {};
  for (const [name, rel] of Object.entries({ ...CHART_FILES, envExample: ENV_EXAMPLE })) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return { error: `${rel} is missing — the chart cannot be checked.` };
    chart[name] = fs.readFileSync(p, 'utf8');
  }
  return { chart };
}

export function render(findings) {
  if (findings.length === 0) {
    return `check-chart: ${CHART_DIR} satisfies all ${POLICIES.length} deployment policies, and every env key it sets is documented in ${ENV_EXAMPLE}.`;
  }
  return [
    ...findings.map((f) => `BLOCK  [${f.rule}] ${f.message}\n       ${f.fix}`),
    '',
    `${findings.length} finding(s). Fix the chart, or change the policy in scripts/deploy/check-chart.mjs with the`,
    'reason — never by loosening the value until this goes quiet.',
  ].join('\n');
}

if (process.argv[1]?.endsWith('check-chart.mjs')) {
  const { chart, error } = loadChart(REPO_ROOT);
  if (error) {
    process.stderr.write(`check-chart: ${error}\n`);
    process.exit(2);
  }
  const findings = runPolicies(chart);
  process[findings.length ? 'stderr' : 'stdout'].write(`${render(findings)}\n`);
  process.exit(findings.length === 0 ? 0 : 1);
}
