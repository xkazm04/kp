#!/usr/bin/env node
// What one run of an agent lane spends, as a number, with a ceiling it stops at.
//
// THE GAP THIS CLOSES: the lanes here already have a bound and it is enforced —
// `agent-dispatch.yml` gives the two model rounds `timeout-minutes: 12` inside a
// 20-minute job, deliberately smaller so the failure reporter still runs. But
// wall-clock is a proxy for cost, and a bad one in both directions: it cannot
// tell an hour of tokens spent across three fast runs from a lane that idled on
// a slow API, and it does not move at all when a prompt quietly doubles. Nothing
// in this repository has ever recorded what a merged agent-authored change cost,
// which means nobody is in a position to notice if that doubled.
//
// THE UNIT IS TOKENS, NOT DOLLARS, and that is deliberate. Tokens are what the
// API reports: exact, per call, no table to maintain and nothing to invent. A
// price list is an operator's contract with a provider, changes without warning,
// and differs per account — so `prices` in agent-budget.json starts EMPTY and the
// ledger reports "no price declared" rather than a made-up figure. Fill it in and
// every report gains a USD column; leave it and the trend is still there in the
// unit that produced it. A cost report that quietly prints $0.00 because nobody
// filled in a table is worse than one that says it does not know.
//
// WHAT STOPS THE LANE. Two ceilings per lane, both fail-closed:
//
//   maxTokens  the whole run's input+output across every call. Checked BEFORE
//              each call, against what has already been spent plus what this call
//              is about to send — so the lane stops instead of discovering it
//              overspent afterwards.
//   maxCalls   how many model calls one run may make. `maxTokens` bounds size;
//              this bounds COUNT, which is the shape a retry loop takes.
//
// A lane with no entry in agent-budget.json cannot run. That is the point: a new
// lane is a new bill, and it starts by saying how large it is allowed to be.
//
// WHERE THE NUMBER LIVES. One JSON line per call, appended to $KP_AGENT_LEDGER,
// and a rendered total in $GITHUB_STEP_SUMMARY plus the proposal body — so the
// figure is attached to the change it bought and is comparable run to run without
// anyone opening a dashboard.
//
//   node scripts/agent/budget.mjs --report <ledger.jsonl>   # totals + verdict
//   node scripts/agent/budget.mjs --report <f> --json
//
// EXIT CODES: 0 within budget · 1 a lane exceeded its ceiling, or the budget file
// could not be believed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUDGET_FILE = 'agent-budget.json';

/**
 * Read and validate. Throws rather than returning a default: a budget file that
 * cannot be parsed must fail the lane, never let it run unmetered.
 */
export function loadBudget(root = REPO_ROOT) {
  const budget = JSON.parse(fs.readFileSync(path.join(root, BUDGET_FILE), 'utf8'));
  if (budget.version !== 1) throw new Error(`${BUDGET_FILE}: unsupported version ${budget.version}`);
  if (!budget.lanes || typeof budget.lanes !== 'object') throw new Error(`${BUDGET_FILE}: 'lanes' must be an object`);
  for (const [lane, limit] of Object.entries(budget.lanes)) {
    for (const field of ['maxTokens', 'maxCalls']) {
      if (!Number.isFinite(limit?.[field])) throw new Error(`${BUDGET_FILE}: lane '${lane}' has no numeric ${field}`);
    }
    if (!limit.why) throw new Error(`${BUDGET_FILE}: lane '${lane}' has no 'why'`);
  }
  if (budget.prices && typeof budget.prices !== 'object') throw new Error(`${BUDGET_FILE}: 'prices' must be an object`);
  return budget;
}

/**
 * Roughly how many tokens a prompt will cost to send. Used ONLY to decide
 * whether a call fits under the remaining ceiling before it is made.
 *
 * Four characters per token is the conventional English approximation and it is
 * an estimate, so it is rounded UP and used only in the direction that is safe:
 * an over-estimate stops a lane slightly early, an under-estimate would let one
 * call through and be caught by the exact count the moment the reply lands.
 */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

/** Total tokens one API usage object represents, cache reads included. */
export function usageTokens(usage) {
  if (!usage) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return (
    n(usage.input_tokens) +
    n(usage.output_tokens) +
    n(usage.cache_creation_input_tokens) +
    n(usage.cache_read_input_tokens)
  );
}

/** USD for one entry, or null when no price is declared for its model. */
export function priceOf(entry, prices = {}) {
  const p = prices?.[entry.model];
  if (!p || !entry.usage) return null;
  const perM = (tokens, rate) => (Number.isFinite(rate) ? (tokens / 1_000_000) * rate : 0);
  const u = entry.usage;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return (
    perM(n(u.input_tokens), p.inputPerMTok) +
    perM(n(u.output_tokens), p.outputPerMTok) +
    perM(n(u.cache_creation_input_tokens), p.cacheWritePerMTok ?? p.inputPerMTok) +
    perM(n(u.cache_read_input_tokens), p.cacheReadPerMTok ?? 0)
  );
}

/**
 * Fold a ledger into per-lane totals and a verdict. Pure — `entries` is the
 * parsed JSONL.
 *
 * `unpriced` is carried separately and never folded into a dollar total. The
 * Claude CLI backend reports no usage at all, so a run on that path is METERED
 * AS UNKNOWN rather than as free: the number of calls is still true, and
 * claiming $0 for them would be the kind of green lie this repository's comms
 * layer is built to avoid.
 */
export function summarise(entries, budget) {
  const lanes = {};
  for (const e of entries) {
    const lane = (lanes[e.lane] ??= { lane: e.lane, calls: 0, tokens: 0, usd: 0, unpricedCalls: 0, models: new Set() });
    lane.calls++;
    lane.models.add(e.model);
    const tokens = usageTokens(e.usage);
    if (tokens === null) {
      lane.unpricedCalls++;
      continue;
    }
    lane.tokens += tokens;
    const usd = priceOf(e, budget.prices?.models);
    if (usd === null) lane.unpricedCalls++;
    else lane.usd += usd;
  }

  const findings = [];
  const rows = Object.values(lanes).map((l) => {
    const limit = budget.lanes[l.lane];
    const row = { ...l, models: [...l.models], maxTokens: limit?.maxTokens ?? null, maxCalls: limit?.maxCalls ?? null };
    if (!limit) {
      findings.push({ lane: l.lane, message: `spent ${l.tokens} tokens and has no ceiling in ${BUDGET_FILE}` });
      return row;
    }
    if (l.tokens > limit.maxTokens) {
      findings.push({ lane: l.lane, message: `${l.tokens} tokens, ceiling ${limit.maxTokens} (${limit.why})` });
    }
    if (l.calls > limit.maxCalls) {
      findings.push({ lane: l.lane, message: `${l.calls} model calls, ceiling ${limit.maxCalls} (${limit.why})` });
    }
    return row;
  });

  return { rows, findings };
}

/** The line a human reads on the run summary and in the pull request body. */
export function render({ rows, findings }, budget) {
  if (!rows.length) return 'agent budget: no model call was made in this run.';
  const lines = ['| lane | calls | tokens | ceiling | cost |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const cost = r.unpricedCalls
      ? `unpriced (${r.unpricedCalls}/${r.calls} call${r.calls === 1 ? '' : 's'})`
      : `$${r.usd.toFixed(4)}`;
    const ceiling = r.maxTokens === null ? '**none declared**' : `${r.maxTokens}`;
    lines.push(`| ${r.lane} | ${r.calls}/${r.maxCalls ?? '—'} | ${r.tokens} | ${ceiling} | ${cost} |`);
  }
  if (!Object.keys(budget.prices?.models ?? {}).length) {
    lines.push(
      '',
      `_No prices are declared in ${BUDGET_FILE}, so cost is reported in tokens only. Fill in ` +
        '`prices.models` from your own provider contract to add a USD column — a report that printed ' +
        '$0.00 from an empty table would be worse than one that says it does not know._',
    );
  }
  if (findings.length) {
    lines.push('', `**Over budget (${findings.length}):**`);
    for (const f of findings) lines.push(`- ${f.lane}: ${f.message}`);
  }
  return lines.join('\n');
}

// --- the meter the lanes actually hold ----------------------------------------

/** Thrown when a call would take a lane past its ceiling. Caught by the lane, which declines. */
export class BudgetExceeded extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetExceeded';
  }
}

/**
 * One lane's meter for one run. Held by the lane, passed to the backend, and
 * asked BEFORE each call whether the call may happen at all.
 */
export class Meter {
  constructor({ lane, budget, ledgerPath = process.env.KP_AGENT_LEDGER || null }) {
    this.lane = lane;
    this.budget = budget;
    this.limit = budget.lanes[lane];
    if (!this.limit) {
      // Fail closed. A lane that is not in the budget is a bill nobody agreed to.
      throw new Error(
        `agent budget: lane "${lane}" has no entry in ${BUDGET_FILE}. ` +
          'Declare maxTokens, maxCalls and a why before running it — a new lane is a new bill.',
      );
    }
    this.ledgerPath = ledgerPath;
    this.calls = 0;
    this.tokens = 0;
    this.entries = [];
  }

  /**
   * May a call of roughly this size happen? Throws BudgetExceeded when not.
   *
   * Checked before rather than after on purpose: a ceiling that is only noticed
   * once it has been passed is a report, not a budget.
   */
  assertRoom(prompt = '') {
    if (this.calls >= this.limit.maxCalls) {
      throw new BudgetExceeded(
        `lane "${this.lane}" has made ${this.calls} model call(s), its ceiling (${this.limit.why}). ` +
          `Raise maxCalls in ${BUDGET_FILE} with a reason, or find out why this run is looping.`,
      );
    }
    const projected = this.tokens + estimateTokens(prompt);
    if (projected > this.limit.maxTokens) {
      throw new BudgetExceeded(
        `lane "${this.lane}" has spent ${this.tokens} tokens and this call would take it to about ` +
          `${projected}, past its ceiling of ${this.limit.maxTokens} (${this.limit.why}). ` +
          `Send less, or raise the ceiling in ${BUDGET_FILE} with a reason.`,
      );
    }
  }

  /** Record what a call actually cost. `usage: null` means the backend reported none. */
  record({ model, usage }) {
    const entry = { at: new Date().toISOString(), lane: this.lane, model, usage: usage ?? null };
    this.calls++;
    this.tokens += usageTokens(usage) ?? 0;
    this.entries.push(entry);
    if (this.ledgerPath) {
      try {
        fs.appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        /* a ledger that cannot be written must not fail the lane; the in-memory total still holds */
      }
    }
    return entry;
  }

  /** The verdict for this run, from what this meter itself saw. */
  summary() {
    return summarise(this.entries, this.budget);
  }
}

// --- CLI ----------------------------------------------------------------------

export function readLedger(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function parseArgs(argv) {
  const out = { report: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') out.report = argv[++i];
    else if (argv[i] === '--json') out.json = true;
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  let budget;
  try {
    budget = loadBudget();
  } catch (err) {
    console.error(`agent budget: ${err.message}`);
    return 1;
  }
  const file = args.report || process.env.KP_AGENT_LEDGER;
  const result = summarise(readLedger(file), budget);
  if (args.json) console.log(JSON.stringify({ ok: result.findings.length === 0, ...result }, null, 2));
  else console.log(render(result, budget));

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, `### What this lane spent\n\n${render(result, budget)}\n`);
    } catch {
      /* not a reason to fail */
    }
  }
  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
