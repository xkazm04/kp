#!/usr/bin/env node
// Fixtures for the agent-provenance trailer block. No deps — run with:
//   node scripts/agent/__tests__/provenance.test.mjs
//
// The load-bearing cases are the two at the bottom: a commit that claims NO
// provenance must pass untouched (most commits here are human), and a commit
// that claims PART of it must fail (three of four keys cannot be joined on, so a
// partial block is provenance that reads like an answer and is not one).
import assert from 'node:assert/strict';
import {
  PROVENANCE_KEYS,
  agentTrailers,
  checkProvenance,
  parseArgs,
  promptDigest,
  renderProvenance,
} from '../provenance.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const COMPLETE = [
  'Agent-model: claude-opus-5',
  'Agent-harness: scripts/agent/dispatch.mjs@1',
  'Agent-prompt: sha256:0123456789abcdef',
  'Agent-run: https://github.com/xkazm04/kp/actions/runs/123456789',
].join('\n');

check('a commit that claims no provenance is silent, not failed', () => {
  assert.deepEqual(checkProvenance(''), []);
  assert.deepEqual(checkProvenance('Refs #12\nDispatched-by: someone'), []);
  assert.deepEqual(checkProvenance(null), []);
});

check('a complete block passes, in a body with other trailers around it', () => {
  assert.deepEqual(checkProvenance(COMPLETE), []);
  assert.deepEqual(checkProvenance(`Some prose.\n\nRefs #12\n${COMPLETE}\nDispatched-by: someone`), []);
});

check('a partial block fails and names every key it is missing', () => {
  const problems = checkProvenance('Agent-model: claude-opus-5');
  assert.equal(problems.length, 3);
  for (const key of ['Agent-harness', 'Agent-prompt', 'Agent-run']) {
    assert.ok(problems.some((p) => p.includes(key)), `expected the missing "${key}" to be named`);
  }
  assert.match(problems[0], /cannot be\s+joined on/);
});

check('an empty value is a claim that reads as an answer', () => {
  const problems = checkProvenance(COMPLETE.replace('claude-opus-5', ''));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"Agent-model:" is empty/);
});

check('a key outside the block is refused — nothing would ever query it', () => {
  const problems = checkProvenance(`${COMPLETE}\nAgent-vibes: excellent`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Agent-vibes/);
  assert.match(problems[0], /Agent-model, Agent-harness, Agent-prompt, Agent-run/);
});

check('the same key twice is refused — a trailer read answers ambiguously', () => {
  const problems = checkProvenance(`${COMPLETE}\nAgent-model: claude-sonnet-5`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /appears twice/);
});

check('a harness without a version is refused', () => {
  const problems = checkProvenance(COMPLETE.replace('scripts/agent/dispatch.mjs@1', 'scripts/agent/dispatch.mjs'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /<path-or-name>@<version>/);
});

check('a hand-written prompt version is refused; a digest is not', () => {
  assert.match(checkProvenance(COMPLETE.replace('sha256:0123456789abcdef', 'v3'))[0], /digest/);
  assert.deepEqual(checkProvenance(COMPLETE.replace('sha256:0123456789abcdef', promptDigest('anything'))), []);
});

check('a run is a URL or the word local, and local is a real answer', () => {
  assert.deepEqual(checkProvenance(COMPLETE.replace(/Agent-run: .*/, 'Agent-run: local')), []);
  assert.match(checkProvenance(COMPLETE.replace(/Agent-run: .*/, 'Agent-run: somewhere'))[0], /neither a URL nor/);
});

check('the digest is stable and changes with the text — that is its whole claim', () => {
  assert.equal(promptDigest('a prompt'), promptDigest('a prompt'));
  assert.notEqual(promptDigest('a prompt'), promptDigest('a prompt '));
  assert.match(promptDigest('a prompt'), /^sha256:[0-9a-f]{16}$/);
});

check('trailers are read as whole lines, so prose that mentions a key is not one', () => {
  assert.deepEqual(agentTrailers('the Agent-model: claude-opus-5 was used'), []);
  assert.deepEqual(agentTrailers('Agent-model: claude-opus-5'), [['Agent-model', 'claude-opus-5']]);
});

check('render refuses to emit a half-block rather than emitting one', () => {
  assert.throws(() => renderProvenance({ model: 'claude-opus-5' }), /refusing to render/);
  const block = renderProvenance({
    model: 'claude-opus-5',
    harness: 'scripts/agent/dispatch.mjs@1',
    prompt: promptDigest('the system prompt'),
    // No run: a local invocation says `local` rather than inventing a URL.
  });
  assert.deepEqual(checkProvenance(block), []);
  assert.match(block, /^Agent-run: local$/m);
  assert.deepEqual(
    block.split('\n').map((line) => line.split(':')[0]),
    PROVENANCE_KEYS,
    'the block renders in the declared order',
  );
});

check('cli args parse', () => {
  assert.deepEqual(parseArgs(['--model', 'm', '--harness', 'h@1', '--run', 'local']), {
    model: 'm',
    harness: 'h@1',
    prompt: null,
    promptFile: null,
    run: 'local',
  });
  assert.equal(parseArgs(['--prompt-file', '/tmp/p.txt']).promptFile, '/tmp/p.txt');
});

console.log(`\nprovenance fixtures: ${passed} checks passed.`);
