#!/usr/bin/env node
// KPI meter — "Candidate-readable reason coverage" (goal a82c273d, "Every
// automated step is explainable to the candidate: each AI verdict along the
// thread carries reasons a candidate could read").
//
// WHAT IT COUNTS, and why this number and not a nearby one. A candidate reading
// /status/<token> sees a LABEL for every decision kind ("Interview assessed with
// AI assistance") and a REASON for almost none. A label is not an explanation —
// Art. 86 asks for the "main elements of the decision" — so the number that
// tracks the goal is: of the candidate-visible decision kinds, how many actually
// put a reason in front of the candidate?
//
// Three independent layers must ALL agree before a kind counts, because each
// alone is satisfiable without the candidate reading anything:
//   1. server  — `redactDecisionForCandidate` (app/_lib/status-decisions.ts) can
//                emit a non-null `facts` for the kind. Two source shapes are
//                understood: the original inline ternary
//                (`facts: record.kind === "auto_rejected" ? … : null`) and the
//                extractor registry (`const FACT_EXTRACTORS = new Map([["kind", fn], …])`
//                looked up by `record.kind`). Anything else exits 2.
//   2. catalog — messages/en.json has a `status.decisions.reasons.<code>` string.
//   3. render  — StatusClient.tsx actually renders `decisions.reasons.<code>`.
// A kind with server facts and no copy renders nothing; copy with no facts
// renders nothing. Counting the intersection is what stops this becoming the
// vacuous counter ADR-0008 was written against.
//
// Keyless, network-free, read-only: files are read through `git show <ref>:path`,
// so it measures ANY ref without a checkout and a pre-merge baseline stays
// reproducible after the merge. Run `git fetch` first for a remote ref.
//
//   node scripts/kpi/explainability-reason-coverage.mjs              # origin/main
//   node scripts/kpi/explainability-reason-coverage.mjs --ref HEAD --json
//
// Exit 0 = a number. Exit 2 = a source moved and the parse no longer bites, so
// NO number is printed. That failure mode is deliberate: this probe reads source
// text, and a refactor (say, a dispatch map replacing the ternary) must show up
// as "re-teach me", never as a silent 0 that looks like a regression or a silent
// pass that looks like progress. (It once did exactly that: the extractor map
// read as 0 fact-bearing kinds. The fixtures in
// scripts/kpi/__tests__/explainability-reason-coverage.test.mjs pin both shapes.)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DECISIONS_TS = "app/_lib/status-decisions.ts";
const STATUS_CLIENT = "app/status/[token]/StatusClient.tsx";
const EN_CATALOG = "messages/en.json";

/** The parse stopped biting. Carries the reason; the CLI turns it into exit 2. */
export class ProbeMoved extends Error {}

function moved(why) {
  throw new ProbeMoved(why);
}

const kindLiterals = (src) => [...new Set([...src.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]))];

/** Layer 1: which kinds can `redactDecisionForCandidate` give a non-null `facts`? */
export function serverFactKindsOf(decisionsSrc) {
  const redactIdx = decisionsSrc.indexOf("export function redactDecisionForCandidate");
  if (redactIdx < 0) moved(`redactDecisionForCandidate is gone from ${DECISIONS_TS}`);
  const body = decisionsSrc.slice(redactIdx);
  const factsMatch = body.match(/\n\s*facts:([\s\S]*?),\n\s*\};/);
  if (!factsMatch) moved(`could not locate the \`facts:\` property of redactDecisionForCandidate's returned literal`);
  const factsExpr = factsMatch[1].trim();

  // A literal `null` is a legitimate zero: no kind carries facts.
  if (factsExpr === "null") return [];

  // Shape A — the inline ternary names its kinds.
  const inline = kindLiterals(factsExpr);
  if (inline.length > 0) return inline;

  // Shape B — the registry. `facts` reads a local bound from `<MAP>.get(record.kind)`
  // (or calls `<MAP>.get(record.kind)` directly); the kinds are that Map's keys.
  const beforeFacts = body.slice(0, factsMatch.index);
  const direct = factsExpr.match(/\b([A-Za-z_$][\w$]*)\.get\(\s*record\.kind\s*\)/);
  let mapName = direct?.[1];
  if (!mapName) {
    const local = factsExpr.match(/^([A-Za-z_$][\w$]*)\s*\?/);
    const binding = local && beforeFacts.match(new RegExp(`\\b(?:const|let)\\s+${local[1]}\\s*=\\s*([A-Za-z_$][\\w$]*)\\.get\\(\\s*record\\.kind\\s*\\)`));
    mapName = binding?.[1];
  }
  if (!mapName) moved(`the \`facts:\` expression names no kind and is not a \`<Map>.get(record.kind)\` lookup: ${factsExpr}`);
  // Lazy up to `= new Map(`: the type annotation itself holds an `=>`.
  const mapDecl = decisionsSrc.match(new RegExp(`\\bconst\\s+${mapName}\\b[^;]*?=\\s*new Map\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)\\s*;`));
  if (!mapDecl) moved(`\`facts\` looks kinds up in ${mapName}, which is no longer a \`new Map([...])\` literal in ${DECISIONS_TS}`);
  const keys = [...new Set([...mapDecl[1].matchAll(/\[\s*"([a-z0-9_]+)"\s*,/g)].map((m) => m[1]))];
  if (keys.length === 0) moved(`parsed ${mapName} but found no \`["kind", extractor]\` entries in it`);
  return keys;
}

/** The whole reading, from the three source texts. Pure: throws ProbeMoved, never exits. */
export function measure({ decisionsSrc, clientSrc, enJson }) {
  // --- layer 0: the allowlist. Every kind a candidate may see at all. ---------
  const allowMatch = decisionsSrc.match(/CANDIDATE_VISIBLE_DECISION_KINDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!allowMatch) moved(`CANDIDATE_VISIBLE_DECISION_KINDS is no longer a \`new Set([...])\` literal in ${DECISIONS_TS}`);
  const visibleKinds = kindLiterals(allowMatch[1]);
  if (visibleKinds.length === 0) moved(`parsed CANDIDATE_VISIBLE_DECISION_KINDS but found no kinds in it`);

  // --- layer 1: server. -------------------------------------------------------
  // A registry may hold a kind the allowlist hides; redaction returns null for it
  // before the lookup, so it is not a door. An INLINE kind outside the allowlist
  // means the parse is reading something other than kinds.
  const parsedFactKinds = serverFactKindsOf(decisionsSrc);
  const serverFactKinds = parsedFactKinds.filter((k) => visibleKinds.includes(k));
  const stray = parsedFactKinds.filter((k) => !visibleKinds.includes(k));
  if (stray.length && serverFactKinds.length === 0) moved(`the fact-bearing kinds ${stray.join(", ")} are none of them in the visible allowlist — the parse is reading something other than kinds`);

  // --- layer 2: catalog. Which reason strings exist for a candidate to read? --
  let en;
  try {
    en = JSON.parse(enJson);
  } catch {
    moved(`messages/en.json did not parse as JSON`);
  }
  const reasons = en?.status?.decisions?.reasons;
  if (!reasons || typeof reasons !== "object") moved(`messages/en.json has no status.decisions.reasons object`);
  const catalogCodes = Object.keys(reasons);

  // --- layer 3: render. Which of those strings does the candidate page print? -
  const renderedCodes = [...new Set([...clientSrc.matchAll(/["'`]decisions\.reasons\.([a-zA-Z0-9_]+)["'`]/g)].map((m) => m[1]))];
  if (renderedCodes.length === 0) moved(`${STATUS_CLIENT} renders no decisions.reasons.* key — the candidate-facing reason surface moved`);

  // --- the intersection -------------------------------------------------------
  // A reason code and a decision kind are not the same vocabulary, so a kind
  // counts when it can carry facts AND a rendered, catalogued reason code exists
  // to print beside them. min() is exact while codes and fact-bearing kinds pair
  // one-to-one (1:1 on main, 2:2 with the rubric facts); if either side widens
  // alone, this file is the thing to sharpen — see Known limits below.
  const readableCodes = renderedCodes.filter((c) => catalogCodes.includes(c));
  const value = Math.min(serverFactKinds.length, readableCodes.length);

  // --- the ratchet beside it: kinds with no candidate-facing LABEL at all -----
  // StatusClient builds `decisionKindLabels` as literal keys because next-intl
  // keys are typed, and the file's own comment names the failure mode: "a kind the
  // server starts exposing without copy here degrades to a de-snaked raw value
  // below". That degraded path prints English snake_case to a candidate in every
  // locale, and nothing fails when it happens — the allowlist and the label map
  // are two lists in two files that no gate compares. This counts the drift.
  const labelsBlock = clientSrc.match(/const decisionKindLabels[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!labelsBlock) moved(`decisionKindLabels is no longer an object literal in ${STATUS_CLIENT}`);
  const labelledKinds = [...new Set([...labelsBlock[1].matchAll(/^\s*([a-z0-9_]+):/gm)].map((m) => m[1]))];
  const unlabelledKinds = visibleKinds.filter((k) => !labelledKinds.includes(k));

  return {
    value,
    denominator: visibleKinds.length,
    visible_kinds: visibleKinds,
    server_fact_kinds: serverFactKinds,
    catalog_reason_codes: catalogCodes,
    rendered_reason_codes: renderedCodes,
    readable_reason_codes: readableCodes,
    labelled_kinds: labelledKinds,
    unlabelled_kinds: unlabelledKinds,
  };
}

function main() {
  const args = process.argv.slice(2);
  const refArg = args.indexOf("--ref");
  const REF = refArg >= 0 ? args[refArg + 1] : "origin/main";
  const JSON_OUT = args.includes("--json");

  const bail = (why) => {
    console.error(`explainability-reason-coverage: ${why}`);
    console.error(`  No reading taken. Re-teach the probe rather than recording a number it did not measure.`);
    process.exit(2);
  };
  const git = (argv) =>
    execFileSync("git", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const show = (path) => {
    try {
      return git(["show", `${REF}:${path}`]);
    } catch {
      return bail(`cannot read ${path} at ${REF} — the file moved or the ref is unfetched`);
    }
  };

  try {
    git(["rev-parse", "--verify", `${REF}^{commit}`]);
  } catch {
    bail(`ref "${REF}" does not resolve (a remote ref needs \`git fetch origin\` first)`);
  }
  const sha = git(["rev-parse", "--short", REF]).trim();

  let r;
  try {
    r = measure({ decisionsSrc: show(DECISIONS_TS), clientSrc: show(STATUS_CLIENT), enJson: show(EN_CATALOG) });
  } catch (e) {
    if (e instanceof ProbeMoved) bail(`${e.message} (at ${REF})`);
    throw e;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ref: REF, sha, ...r }, null, 2));
  } else {
    console.log(`  candidate-visible decision kinds ...... ${r.visible_kinds.length}  (${r.visible_kinds.join(", ")})`);
    console.log(`  kinds that can carry facts (server) ... ${r.server_fact_kinds.length}  (${r.server_fact_kinds.join(", ") || "none"})`);
    console.log(`  reason strings in messages/en.json .... ${r.catalog_reason_codes.length}  (${r.catalog_reason_codes.join(", ") || "none"})`);
    console.log(`  reason strings the page renders ....... ${r.rendered_reason_codes.length}  (${r.rendered_reason_codes.join(", ") || "none"})`);
    console.log(`  kinds with a localized label .......... ${r.labelled_kinds.length}`);
    console.log(`REASON_COVERAGE=${r.value}/${r.denominator} at ${REF}=${sha}`);
    console.log(`UNLABELLED_KINDS=${r.unlabelled_kinds.length}${r.unlabelled_kinds.length ? "  (" + r.unlabelled_kinds.join(", ") + ")" : ""}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Known limits, stated so the next reader does not over-trust the number:
//  - It counts DOORS, not corpus rows: "this kind CAN show a reason", not "N% of
//    real verdicts did". The corpus-walking counter is idea 43bcd466, unshipped.
//  - The denominator is every visible kind, including ones no candidate is owed
//    a reason for (interview_cancelled). The goal's own denominator is the
//    AI-verdict subset — 5 kinds are sealed by machine writers today
//    (auto_rejected, auto_advanced, ai_scorecard, group_eval_lead,
//    group_eval_advisory) — which is why the KPI's target is 5 and not 14.
