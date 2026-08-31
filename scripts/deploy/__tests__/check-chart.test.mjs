#!/usr/bin/env node
// Fixtures for the chart policy. No deps — run with:
//   node scripts/deploy/__tests__/check-chart.test.mjs
//
// Two halves, and the second is the one that matters. The cases below prove each
// policy FIRES on the regression it names — a policy that cannot fail is a
// comment with an exit code. The cases at the bottom run the real chart, so the
// file that ships is the fixture: fix a policy by loosening values.yaml and this
// stays green while the tree it was protecting has moved.
//
// The regressions are written the way they would actually arrive: `replicas:
// {{ .Values.replicaCount }}` looks like the tidy-up a reviewer would approve,
// and it is the one that corrupts the database.

import assert from 'node:assert/strict';

import {
  CHART_DIR,
  POLICIES,
  blockOf,
  checkEnvContract,
  documentedEnvKeys,
  envKeysIn,
  loadChart,
  runPolicies,
  valueOf,
} from '../check-chart.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const has = (findings, rule) => findings.some((f) => f.rule === rule);

// A chart that satisfies every policy. Each case below breaks exactly one thing.
const GOOD = {
  values: [
    'auth:',
    '  operatorPassword: ""',
    '  secret: ""',
    'providerKeys: {}',
    'env:',
    '  APP_ORIGIN: ""',
    'extraEnv: {}',
    'persistence:',
    '  accessMode: ReadWriteOnce',
    'service:',
    '  type: ClusterIP',
    'resources:',
    '  limits:',
    '    memory: 1Gi',
    'podSecurityContext:',
    '  runAsNonRoot: true',
    '  runAsUser: 10001',
    'securityContext:',
    '  allowPrivilegeEscalation: false',
    '  capabilities:',
    '    drop: ["ALL"]',
    'livenessProbe:',
    '  httpGet:',
    '    path: /',
    'readinessProbe:',
    '  httpGet:',
    '    path: /',
  ].join('\n'),
  deployment: [
    'spec:',
    '  replicas: 1',
    '  strategy:',
    '    type: Recreate',
    '  template:',
    '    spec:',
    '      securityContext:',
    '        {{- toYaml .Values.podSecurityContext | nindent 8 }}',
    '      containers:',
    '        - name: kp',
    '          securityContext:',
    '            {{- toYaml .Values.securityContext | nindent 12 }}',
    '          livenessProbe:',
    '            {{- toYaml .Values.livenessProbe | nindent 12 }}',
    '          readinessProbe:',
    '            {{- toYaml .Values.readinessProbe | nindent 12 }}',
    '          resources:',
    '            {{- toYaml .Values.resources | nindent 12 }}',
  ].join('\n'),
  service: 'spec:\n  type: {{ .Values.service.type }}\n',
  configmap: 'data:\n  KP_DB_PATH: /data/kp.sqlite\n  NODE_ENV: production\n',
  secret: 'stringData:\n  KP_SECRET: {{ .Values.auth.secret | quote }}\n',
  envExample: 'APP_ORIGIN=\n# KP_DB_PATH=\nKP_SECRET=\n',
};

const broken = (patch) => runPolicies({ ...GOOD, ...patch });

// --- the readers --------------------------------------------------------------

check('a block stops at the next top-level key, not at the end of the file', () => {
  // `env:` followed by `extraEnv:` is the real shape, and a reader that ran on
  // would attribute every later key in values.yaml to the env contract.
  assert.deepEqual(envKeysIn(blockOf(GOOD.values, 'env')), ['APP_ORIGIN']);
});

check('a value is read without its trailing comment, and quotes are stripped', () => {
  assert.equal(valueOf('service:\n  type: ClusterIP   # "" = cluster default\n', 'type'), 'ClusterIP');
  assert.equal(valueOf('auth:\n  secret: ""   # required\n', 'secret'), '');
  assert.equal(valueOf('a:\n  b: 1\n', 'missing'), null);
});

check('.env.example documents a variable whether or not the line is commented out', () => {
  const keys = documentedEnvKeys('FOO=1\n# BAR=\n#   BAZ=x\nnot a key\n');
  assert.deepEqual([...keys].sort(), ['BAR', 'BAZ', 'FOO']);
});

check('template lines and comments are not env keys', () => {
  assert.deepEqual(envKeysIn('data:\n  # A_COMMENT: x\n  {{ $key }}: {{ $val }}\n  REAL_KEY: v\n'), ['REAL_KEY']);
});

// --- every policy fires on the regression it names ----------------------------

check('the good fixture is clean — otherwise nothing below proves anything', () => {
  assert.deepEqual(runPolicies(GOOD), []);
});

check('THE ONE THAT LOOKS LIKE A TIDY-UP: replicas wired back to a value', () => {
  const f = broken({ deployment: GOOD.deployment.replace('replicas: 1', 'replicas: {{ .Values.replicaCount }}') });
  assert.ok(has(f, 'replicas-not-pinned'));
});

check('a rolling update overlaps two writers on one volume', () => {
  const f = broken({ deployment: GOOD.deployment.replace('type: Recreate', 'type: RollingUpdate') });
  assert.ok(has(f, 'strategy-not-recreate'));
});

check('hardened values the Deployment stopped applying are still a finding', () => {
  // The failure the values-only check could never see: the block is still there,
  // correct, and nothing mounts it.
  const f = broken({ deployment: GOOD.deployment.replace('{{- toYaml .Values.securityContext | nindent 12 }}', '{}') });
  assert.ok(has(f, 'security-context-not-applied'));
});

check('running as root, or as uid 0 by another name', () => {
  assert.ok(has(broken({ values: GOOD.values.replace('runAsNonRoot: true', 'runAsNonRoot: false') }), 'runs-as-root'));
  assert.ok(has(broken({ values: GOOD.values.replace('runAsUser: 10001', 'runAsUser: 0') }), 'runs-as-root'));
});

check('privilege escalation and capabilities', () => {
  assert.ok(
    has(
      broken({ values: GOOD.values.replace('allowPrivilegeEscalation: false', 'allowPrivilegeEscalation: true') }),
      'privilege-escalation-allowed',
    ),
  );
  assert.ok(has(broken({ values: GOOD.values.replace('drop: ["ALL"]', 'drop: ["NET_RAW"]') }), 'capabilities-not-dropped'));
});

check('a privileged container or a host namespace anywhere in the templates', () => {
  assert.ok(has(broken({ deployment: `${GOOD.deployment}\n          privileged: true\n` }), 'privileged-pod'));
  assert.ok(has(broken({ deployment: `${GOOD.deployment}\n      hostNetwork: true\n` }), 'privileged-pod'));
});

check('a default install does not put itself on a LoadBalancer', () => {
  assert.ok(has(broken({ values: GOOD.values.replace('type: ClusterIP', 'type: LoadBalancer') }), 'service-exposed-by-default'));
});

check('a secret that shipped in values.yaml, by any of three routes', () => {
  assert.ok(has(broken({ values: GOOD.values.replace('operatorPassword: ""', 'operatorPassword: "hunter2"') }), 'secret-literal-in-values'));
  assert.ok(has(broken({ values: GOOD.values.replace('providerKeys: {}', 'providerKeys:\n  GEMINI_API_KEY: "x"') }), 'secret-literal-in-values'));
  assert.ok(
    has(broken({ values: `${GOOD.values}\ncomment: "sk-abcdefghijklmnopqrstuvwx"\n` }), 'secret-literal-in-values'),
    'a credential-shaped literal anywhere in the file, not only in the keys we know to look at',
  );
});

check('an unbounded pod, and probes that are declared but never applied', () => {
  assert.ok(has(broken({ values: GOOD.values.replace('  limits:\n    memory: 1Gi', '  requests:\n    cpu: 250m') }), 'no-memory-limit'));
  assert.ok(
    has(broken({ deployment: GOOD.deployment.replace('.Values.readinessProbe', '.Values.livenessProbe') }), 'no-probes'),
  );
});

check('a shared volume access mode', () => {
  assert.ok(has(broken({ values: GOOD.values.replace('ReadWriteOnce', 'ReadWriteMany') }), 'volume-access-mode-shared'));
});

// --- the env contract ---------------------------------------------------------

check('a chart env key .env.example never documents is a finding', () => {
  const f = checkEnvContract({ ...GOOD, values: GOOD.values.replace('APP_ORIGIN: ""', 'APP_ORIGIN_V2: ""') });
  assert.ok(has(f, 'env-contract-drift'));
  assert.match(f[0].message, /APP_ORIGIN_V2/);
});

check('the contract covers the ConfigMap and the Secret, not only values.env', () => {
  assert.ok(has(checkEnvContract({ ...GOOD, configmap: 'data:\n  KP_NEW_KNOB: x\n' }), 'env-contract-drift'));
  assert.ok(has(checkEnvContract({ ...GOOD, secret: 'stringData:\n  KP_NEW_SECRET: x\n' }), 'env-contract-drift'));
});

check('NODE_ENV is exempt with a stated reason, not silently ignored', () => {
  assert.deepEqual(checkEnvContract(GOOD), [], 'the fixture pins NODE_ENV and .env.example does not document it');
});

// --- against the real chart ---------------------------------------------------

check('every policy carries the reason it exists', () => {
  for (const p of POLICIES) {
    assert.ok(p.why && p.why.length > 20, `${p.rule} has no stated reason`);
    assert.equal(typeof p.check, 'function');
  }
});

check(`the shipped ${CHART_DIR} satisfies every policy`, () => {
  const { chart, error } = loadChart();
  assert.equal(error, undefined, error);
  const findings = runPolicies(chart);
  assert.deepEqual(findings, [], `findings:\n${JSON.stringify(findings, null, 2)}`);
});

console.log(`\n${passed} checks passed.`);
