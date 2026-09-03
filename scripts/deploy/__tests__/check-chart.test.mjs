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
  REVIEWED_TEMPLATES,
  blockOf,
  checkEnvContract,
  documentedEnvKeys,
  envKeysIn,
  loadChart,
  probeEndpoint,
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
    '  tcpSocket:',
    '    port: http',
    'readinessProbe:',
    '  httpGet:',
    '    path: /api/health',
    '    port: http',
  ].join('\n'),
  deployment: [
    'spec:',
    '  replicas: 1',
    '  strategy:',
    '    type: Recreate',
    '  template:',
    '    metadata:',
    '      annotations:',
    '        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}',
    '        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}',
    '    spec:',
    '      serviceAccountName: kp',
    '      automountServiceAccountToken: false',
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

// The whole-tree view. The named handles above ARE templates — the gate keeps
// both because a policy that must read the Deployment cannot be handed "some
// template" — so the fixture holds them once and derives this. Every name here
// is one REVIEWED_TEMPLATES knows, in both directions: an extra file is a
// finding, and so is an entry whose file is gone.
GOOD.templates = {
  'deployment.yaml': GOOD.deployment,
  'service.yaml': GOOD.service,
  'configmap.yaml': GOOD.configmap,
  'secret.yaml': GOOD.secret,
  'serviceaccount.yaml': 'apiVersion: v1\nkind: ServiceAccount\nautomountServiceAccountToken: false\n',
  'ingress.yaml': '{{- if .Values.ingress.enabled }}\nkind: Ingress\n{{- end }}\n',
  'pvc.yaml': 'kind: PersistentVolumeClaim\n',
  'pdb.yaml': 'kind: PodDisruptionBudget\nspec:\n  minAvailable: 1\n',
  '_helpers.tpl': '{{- define "kp.name" -}}kp{{- end -}}\n',
  'NOTES.txt': 'KP is deploying.\n',
};

/**
 * Patch the fixture. Patching a named handle patches the template of the same
 * name too, since they are the same document — otherwise a case would prove a
 * policy fires on a file the real loader never sees in that state.
 */
function patched(patch) {
  const chart = { ...GOOD, ...patch };
  if (!patch.templates) {
    chart.templates = { ...GOOD.templates };
    for (const [handle, name] of [
      ['deployment', 'deployment.yaml'],
      ['service', 'service.yaml'],
      ['configmap', 'configmap.yaml'],
      ['secret', 'secret.yaml'],
    ]) {
      chart.templates[name] = chart[handle];
    }
  }
  return chart;
}

const broken = (patch) => runPolicies(patched(patch));

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

check('THE FILE THE GATE USED NOT TO READ: a template nobody named', () => {
  // This is the hole the five-file allowlist left. A new templates/worker.yaml
  // with a root container on the host network passed every policy, because no
  // policy had ever opened it.
  const withWorker = {
    templates: { ...GOOD.templates, 'worker.yaml': 'kind: Deployment\nspec:\n  hostNetwork: true\n  privileged: true\n' },
  };
  const f = runPolicies({ ...GOOD, ...withWorker });
  assert.ok(has(f, 'privileged-pod'), 'the hardening rule now reaches a file added after it was written');
  assert.ok(has(f, 'unreviewed-template'), 'and the file itself is a finding until somebody says what it is');

  // BOTH DIRECTIONS, the discipline .ai/manifest.yaml already applies to CI
  // gates: listed passes, and an entry whose file is gone fails as stale.
  const reviewed = new Map([...REVIEWED_TEMPLATES, ['worker.yaml', 'the fixture worker']]);
  assert.deepEqual(
    runPolicies({ ...GOOD, ...withWorker, reviewed }).filter((x) => x.rule === 'unreviewed-template'),
    [],
    'a template named in REVIEWED_TEMPLATES is not itself a finding',
  );
  const stale = runPolicies({ ...GOOD, reviewed: new Map([...REVIEWED_TEMPLATES, ['gone.yaml', 'deleted last week']]) });
  assert.ok(has(stale, 'unreviewed-template'), 'an entry whose template is gone is stale');
  assert.match(stale.find((x) => x.rule === 'unreviewed-template').message, /gone\.yaml/);
});

check('a pod running as the default ServiceAccount, or with its token projected', () => {
  // kp calls no Kubernetes API, so the token is a credential with no purpose in
  // a pod holding candidate PII. Each of the four ways to lose it is a finding.
  const noName = GOOD.deployment.replace('      serviceAccountName: kp\n', '');
  assert.ok(has(broken({ deployment: noName }), 'service-account-token-mounted'));
  const mounted = GOOD.deployment.replace('automountServiceAccountToken: false', 'automountServiceAccountToken: true');
  assert.ok(has(broken({ deployment: mounted }), 'service-account-token-mounted'));
  const noSa = { ...GOOD.templates };
  delete noSa['serviceaccount.yaml'];
  assert.ok(
    has(runPolicies({ ...GOOD, templates: noSa, reviewed: new Map([...REVIEWED_TEMPLATES].filter(([n]) => n !== 'serviceaccount.yaml')) }), 'service-account-token-mounted'),
    'no ServiceAccount template at all',
  );
  assert.ok(
    has(
      runPolicies({
        ...GOOD,
        templates: { ...GOOD.templates, 'serviceaccount.yaml': 'kind: ServiceAccount\n' },
      }),
      'service-account-token-mounted',
    ),
    'a ServiceAccount that leaves token projection on',
  );
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

check('THE OTHER TIDY-UP: both probes pointed at one endpoint', () => {
  // Declared, applied, and wrong: the restarter and the router now read the same
  // answer, so a degraded dependency crash-loops the only pod instead of taking
  // it out of service. Both spellings of the mistake — one path, and one port.
  const oneHttpPath = GOOD.values.replace('livenessProbe:\n  tcpSocket:\n    port: http', 'livenessProbe:\n  httpGet:\n    path: /api/health\n    port: http');
  const f = broken({ values: oneHttpPath });
  assert.ok(has(f, 'no-probes'), 'two httpGet probes on /api/health');
  assert.match(f.find((x) => x.rule === 'no-probes').message, /http:\/api\/health/);

  const oneTcpPort = GOOD.values.replace('readinessProbe:\n  httpGet:\n    path: /api/health\n    port: http', 'readinessProbe:\n  tcpSocket:\n    port: http');
  assert.ok(has(broken({ values: oneTcpPort }), 'no-probes'), 'two tcpSocket probes on one port — readiness stopped observing anything');

  // And the shape that must stay clean: different questions, different reads.
  assert.equal(probeEndpoint(GOOD.values, 'livenessProbe'), 'tcp:http');
  assert.equal(probeEndpoint(GOOD.values, 'readinessProbe'), 'http:/api/health');
});

check('a node drain that nothing refuses', () => {
  const noPdb = { ...GOOD.templates };
  delete noPdb['pdb.yaml'];
  const reviewed = new Map([...REVIEWED_TEMPLATES].filter(([n]) => n !== 'pdb.yaml'));
  assert.ok(has(runPolicies({ ...GOOD, templates: noPdb, reviewed }), 'no-disruption-budget'));
  // The decorative form: the object exists and constrains nothing, which is the
  // failure the values/Deployment pairing above exists to catch elsewhere.
  assert.ok(
    has(runPolicies({ ...GOOD, templates: { ...GOOD.templates, 'pdb.yaml': 'kind: PodDisruptionBudget\nspec: {}\n' } }), 'no-disruption-budget'),
  );
});

check('a credential rotation the running pod never sees', () => {
  // The ConfigMap is hashed and the Secret is not: `helm upgrade --set
  // auth.secret=<new>` then reports success while the container still holds the
  // old value, because envFrom.secretRef is read once at start.
  const noHash = GOOD.deployment.replace(
    '        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}\n',
    '',
  );
  assert.ok(has(broken({ deployment: noHash }), 'secret-not-in-rollout-checksum'));
  // Hashing the ConfigMap twice under the secret's name is not the same fact.
  const wrongFile = GOOD.deployment.replace('"/secret.yaml"', '"/configmap.yaml"');
  assert.ok(has(broken({ deployment: wrongFile }), 'secret-not-in-rollout-checksum'));
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
