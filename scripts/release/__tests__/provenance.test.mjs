#!/usr/bin/env node
// Fixtures for the provenance reader. No deps — run with:
//   node scripts/release/__tests__/provenance.test.mjs
//
// Two things are being pinned here. First, that the reader answers the questions
// the trailer vocabulary exists for on the history this repository ALREADY has —
// `Co-Authored-By` and `Ascent-Resolves` — rather than only on history written
// after a lane is changed. Second, that the validation is narrow: an ABSENT
// trailer must never be a finding, because a gate that demanded a trailer no
// lane writes yet would go red on every automated commit and be bypassed within
// a day.

import assert from 'node:assert/strict';

import { TRAILERS, checkTrailers, parsePairs, parseTrailers, provenanceOf, render, summarize } from '../provenance.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const AGENT_COMMIT = {
  subject: 'fix(auth): stop the session cookie leaking on redirect',
  body: ['The narrative goes here.', '', 'Ascent-Resolves: 549354bd-ff8f', 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'].join('\n'),
};

const STRUCTURED_COMMIT = {
  subject: 'feat(schedule): honour the candidate timezone',
  body: 'Agent-Provenance: agent=claude-code; model=claude-opus-5; lane=ascent; task=abc123\n',
};

const HUMAN_COMMIT = { subject: 'docs: fix a typo', body: 'No trailers at all.\n' };

// --- the readers --------------------------------------------------------------

check('trailers are read as key/value, and a conventional subject is not one', () => {
  const t = parseTrailers('feat(api): a route\n\nAscent-Resolves: x1\nCo-Authored-By: A <a@b>\n');
  assert.deepEqual(t.map((x) => x.key), ['Ascent-Resolves', 'Co-Authored-By']);
});

check('semicolon pairs, tolerant of spacing', () => {
  assert.deepEqual(parsePairs('agent=a;  model = m ; lane=l'), { agent: 'a', model: 'm', lane: 'l' });
  assert.deepEqual(parsePairs('just prose'), {});
});

// --- what a commit says about who wrote it ------------------------------------

check("TODAY'S HISTORY IS QUERYABLE: a co-author line alone identifies the agent and model", () => {
  // The point of the whole exercise. Nothing had to change in the lane for this
  // question to become answerable — the facts were already in the commit, in a
  // form nothing read.
  const p = provenanceOf(AGENT_COMMIT);
  assert.equal(p.authorship, 'agent');
  assert.deepEqual(p.models, ['Claude Opus 5']);
  assert.deepEqual(p.tasks, ['549354bd-ff8f']);
  assert.equal(p.structured, false, 'recognisable, but the lane is still not answerable');
});

check('the structured trailer answers agent, model, lane and task', () => {
  const p = provenanceOf(STRUCTURED_COMMIT);
  assert.equal(p.authorship, 'agent');
  assert.equal(p.structured, true);
  assert.deepEqual(p.agents, ['claude-code']);
  assert.deepEqual(p.models, ['claude-opus-5']);
  assert.deepEqual(p.lanes, ['ascent']);
  assert.deepEqual(p.tasks, ['abc123']);
});

check('a human co-author is not an agent', () => {
  const p = provenanceOf({ subject: 's', body: 'Co-Authored-By: Jo Bloggs <jo@example.com>\n' });
  assert.equal(p.authorship, 'human');
  assert.deepEqual(p.models, []);
});

check('no trailers means human, not "unknown"', () => {
  assert.equal(provenanceOf(HUMAN_COMMIT).authorship, 'human');
});

// --- the roll-up --------------------------------------------------------------

check('the summary separates "an agent was involved" from "fully attributable"', () => {
  const s = summarize([AGENT_COMMIT, STRUCTURED_COMMIT, HUMAN_COMMIT]);
  assert.equal(s.total, 3);
  assert.equal(s.agentAuthored, 2);
  assert.equal(s.fullyAttributed, 1, 'the co-author-only commit is recognised but not attributed');
  assert.deepEqual(s.tasks.sort(), ['549354bd-ff8f', 'abc123']);
  assert.match(render(s, 'HEAD~3..HEAD'), /agent-authored:\s+2 \(67%\)/);
});

check('the report names the gap it cannot close itself', () => {
  // The lane's commit template is not in this repository, so the honest output is
  // a number and the one-line instruction — never a claim that it is handled.
  assert.match(render(summarize([AGENT_COMMIT]), 'r'), /Agent-Provenance: agent=…; model=…; lane=…; task=…/);
  assert.doesNotMatch(render(summarize([STRUCTURED_COMMIT]), 'r'), /commit template/);
});

// --- the gate: present-and-malformed only -------------------------------------

check('ABSENT trailers are never a finding — the rule everything else depends on', () => {
  assert.deepEqual(checkTrailers(''), []);
  assert.deepEqual(checkTrailers(HUMAN_COMMIT.body), []);
  assert.deepEqual(checkTrailers(AGENT_COMMIT.body), []);
  assert.deepEqual(checkTrailers(STRUCTURED_COMMIT.body), []);
});

check('an empty trailer value is a finding, and the message states the shape', () => {
  const p = checkTrailers('Ascent-Resolves:\n');
  assert.equal(p.length, 1);
  assert.match(p[0], /Ascent-Resolves/);
});

check('an Agent-Provenance trailer with no key=value pair answers no query', () => {
  const p = checkTrailers('Agent-Provenance: written by the overnight run\n');
  assert.equal(p.length, 1);
  assert.match(p[0], /key=value/);
});

check('a co-author with no <email> is not the trailer git readers key on', () => {
  assert.equal(checkTrailers('Co-Authored-By: Claude\n').length, 1);
  assert.deepEqual(checkTrailers('Co-Authored-By: Claude <x@y>\n'), []);
});

check('an unknown trailer key is left alone — this is a vocabulary, not an allow-list', () => {
  assert.deepEqual(checkTrailers('Doc-sync: internal-only — a script\nGate-exemption: why\n'), []);
});

check('every trailer in the vocabulary documents its shape and its meaning', () => {
  for (const [key, spec] of Object.entries(TRAILERS)) {
    assert.ok(spec.shape, `${key} has no shape`);
    assert.ok(spec.means?.length > 20, `${key} does not say what a reader gets from it`);
  }
});

console.log(`\n${passed} checks passed.`);
