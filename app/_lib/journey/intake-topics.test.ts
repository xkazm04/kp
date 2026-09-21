// The intake-round topic classifier (journey/intake-topics.ts) and the seam it runs on.
//
// Three properties are under test, and only the first is about keywords:
//
//   1. IT CLASSIFIES, AND IT REFUSES. A round it can place gets one code from the closed
//      vocabulary; a round it cannot gets `null`. "We could not tell" and "it was about
//      the salary band" are different facts about what a hiring manager said, and a
//      classifier that guesses to avoid a null turns the second into a confident lie.
//   2. IT IS KEYLESS AND DETERMINISTIC. kp degrades gracefully with no API keys as a
//      product property; the whole path is exercised here with every provider variable
//      cleared, and the same input classifies the same way twice.
//   3. IT IS NOT ON THE TASK HUB'S IMPORT GRAPH. The runner that calls it is registered
//      at boot (late-bound-boot.ts) and looked up through the leaf registry, precisely so
//      neither it nor its store is paid for by the ~60 routes that import app/_lib/
//      tasks.ts. That is asserted by WALKING the graph, not by reading a comment.
//
// Deliberately DB-free: the classifier is pure, and a test that booted SQLite to prove a
// string-matching property would be measuring the wrong thing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyIntakeRound, INTAKE_TOPIC_CODES } from "./intake-topics.ts";
import { JOURNEY_TOPIC_CODES, isJourneyTopicCode } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "..");
const appDir = path.resolve(libDir, "..");
const repoRoot = path.resolve(appDir, "..");

// ---- 1. It classifies, and it refuses --------------------------------------

/** Czech first, on purpose: the seeded intake corpus is Czech (36 rows, 143 turns in the
 *  operator's own database on 2026-09-21), so an English-only classifier would refuse
 *  every round that actually exists today and the board would paint a column of blanks. */
const CZECH: [question: string, answer: string, expected: string][] = [
  ["Pojďme tu roli nadefinovat společně.", "Je to náhrada — odešel nám Jarda, senior Java vývojář.", "backfill-reason"],
  ["Je to nová role, nebo náhrada?", "Nová pozice, rozšiřujeme tým o další místo.", "role-shape"],
  ["Jaké mzdové rozpětí máte schválené?", "Rozpočet je do 120 000 Kč hrubého.", "salary-band"],
  ["Jak to máte s docházkou?", "Hybridní režim, dva dny v kanceláři.", "work-mode"],
  ["Kdy by měl nastoupit?", "Co nejdřív, termín nástup do konce září.", "timeline"],
  ["Jaké dovednosti jsou nutné?", "Musí umět Javu, zkušenost s platebními systémy.", "must-have-skills"],
  ["Do jakého týmu to bude?", "Do platebního týmu, kolegové jsou čtyři.", "team-context"],
  ["Jakou seniorita si představujete?", "Senior, aspoň pět let praxe.", "seniority"],
  ["Co bude znamenat úspěch?", "Za prvních 90 dní samostatně vydá release.", "first-90-days"],
  ["Jak tu pozici pojmenujeme?", "Název pozice bude Senior Java Engineer.", "role-title"],
];

const ENGLISH: [question: string, answer: string, expected: string][] = [
  ["Why is the seat open?", "It is a backfill — our senior engineer resigned last month.", "backfill-reason"],
  ["Is this a new seat?", "Brand new — it is an expansion of the team.", "role-shape"],
  ["What is the budget?", "The salary band tops out around 120k.", "salary-band"],
  ["Where will they work?", "Hybrid, two days in office a week.", "work-mode"],
  ["When do you need them?", "The start date is urgent, ideally next month.", "timeline"],
  ["What must they know?", "The required skills are Java and payments.", "must-have-skills"],
  ["Who will they work with?", "A team of four in the payments department.", "team-context"],
  ["What level?", "Senior — five years of experience at least.", "seniority"],
  ["What does good look like?", "In the first 90 days they ship a release alone.", "first-90-days"],
  ["What do we call it?", "The job title is Senior Java Engineer.", "role-title"],
];

for (const [question, answer, expected] of [...CZECH, ...ENGLISH]) {
  test(`classifies "${answer.slice(0, 44)}…" as ${expected}`, () => {
    assert.equal(classifyIntakeRound({ question, answer }), expected);
  });
}

test("a round it cannot place REFUSES rather than guessing", () => {
  for (const answer of ["Ano.", "Yes, exactly.", "Hmm.", "👍", "12345"]) {
    assert.equal(classifyIntakeRound({ question: "", answer }), null, `"${answer}" must not be placed`);
  }
});

test("the question alone carries the round when the answer is bare", () => {
  // A requestor who answers "ano" to "jaké mzdové rozpětí máte?" has still had a round
  // about the salary band; reading only the answer would throw that away.
  assert.equal(classifyIntakeRound({ question: "Jaké mzdové rozpětí máte schválené?", answer: "Ano." }), "salary-band");
});

test("diacritics are not required — Czech typed without them classifies identically", () => {
  assert.equal(classifyIntakeRound({ answer: "Je to nahrada, odesel nam Jarda." }), "backfill-reason");
  assert.equal(classifyIntakeRound({ answer: "Je to náhrada, odešel nám Jarda." }), "backfill-reason");
});

test("a keyword must be a WORD, not a substring", () => {
  // "nekdy" ("sometimes") contains "kdy" ("when"). ASCII \b would have let the timeline
  // rule fire on it; the letter-class lookaround is what stops it.
  assert.equal(classifyIntakeRound({ answer: "Někdy to tak děláme." }), null);
});

test("it never throws, whatever it is handed", () => {
  const hostile = [
    {},
    { question: undefined, answer: undefined },
    { answer: "x".repeat(200_000) },
    { question: "\u0000�", answer: "\\" },
  ];
  for (const input of hostile) {
    assert.doesNotThrow(() => classifyIntakeRound(input as { question?: string; answer?: string }));
  }
});

test("it is deterministic — the same round classifies the same way, every time", () => {
  const round = { question: "Jaké mzdové rozpětí máte?", answer: "Do 120 000 Kč, rozpočet je schválený." };
  const first = classifyIntakeRound(round);
  for (let i = 0; i < 20; i += 1) assert.equal(classifyIntakeRound(round), first);
  assert.equal(first, "salary-band");
});

// ---- The vocabulary and the catalogs ---------------------------------------

test("every code this module can emit is in the closed vocabulary types.ts owns", () => {
  assert.ok(INTAKE_TOPIC_CODES.length > 0);
  for (const code of INTAKE_TOPIC_CODES) {
    assert.ok(isJourneyTopicCode(code), `${code} is not a JourneyTopicCode`);
    assert.ok((JOURNEY_TOPIC_CODES as readonly string[]).includes(code));
  }
});

test("every emittable code has its catalog key in ALL FOUR locales", () => {
  // The renderer resolves `journey.topics.<code>` in the reader's language. A code with
  // no key paints a blank row for three quarters of this product's readers, and
  // `npm run i18n:check` only pins parity BETWEEN catalogs — it cannot know which codes
  // this module can produce.
  for (const locale of ["en", "cs", "de", "fr"]) {
    const file = path.join(repoRoot, "messages", `${locale}.json`);
    const catalog = JSON.parse(readFileSync(file, "utf8")) as { journey?: { topics?: Record<string, string> } };
    const topics = catalog.journey?.topics ?? {};
    for (const code of INTAKE_TOPIC_CODES) {
      assert.ok(
        typeof topics[code] === "string" && topics[code].trim().length > 0,
        `messages/${locale}.json is missing journey.topics.${code}`
      );
    }
  }
});

// ---- 2. Keyless ------------------------------------------------------------

test("the whole classification path runs with NO provider configured", () => {
  const cleared = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "DASHSCOPE_API_KEY",
    "OLLAMA_BASE_URL",
    "KP_LLM_CONFIG",
  ];
  const saved = cleared.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of cleared) delete process.env[k];
    assert.equal(classifyIntakeRound({ question: "What is the budget?", answer: "The salary band is 120k." }), "salary-band");
    assert.equal(classifyIntakeRound({ answer: "Je to náhrada, odešel nám kolega." }), "backfill-reason");
  } finally {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
});

test("the classifier reaches no model, no network and no subprocess — by source, not by promise", () => {
  const src = readFileSync(path.join(here, "intake-topics.ts"), "utf8").replace(/\r\n/g, "\n");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  for (const forbidden of [/\bfetch\s*\(/, /\bspawn\w*\s*\(/, /llm-config/, /python-runner/, /require\s*\(/]) {
    assert.equal(forbidden.test(code), false, `intake-topics.ts must not reference ${forbidden}`);
  }
  // Exactly one import, and it is the vocabulary. A second one is a decision, not a tidy.
  const imports = [...code.matchAll(/^\s*import\s[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./types"], "the classifier is a leaf over the topic vocabulary");
});

// ---- 3. The seam: registered at boot, and OFF the task hub's graph ----------

/** The kind the intake route looks up, read out of the route's source. */
function routeRunnerKind(): string {
  const route = path.join(appDir, "api", "intake", "[id]", "message", "route.ts");
  const src = readFileSync(route, "utf8");
  const m = src.match(/externalRunner\(([A-Z_]+|"[a-z_]+")\)/);
  assert.ok(m, "the intake message route no longer looks a runner up — update this test");
  const constMatch = src.match(/const INTAKE_ROUND_RUNNER = "([a-z_]+)"/);
  assert.ok(constMatch, "the route declares its runner kind as a named constant");
  return constMatch[1];
}

test("the kind the route looks up is the kind late-bound-boot.ts registers", () => {
  const boot = readFileSync(path.join(libDir, "late-bound-boot.ts"), "utf8");
  const registered = [...boot.matchAll(/registerTaskRunner\("([a-z_]+)"/g)].map((m) => m[1]);
  const kind = routeRunnerKind();
  assert.equal(kind, "intake_round");
  assert.ok(
    registered.includes(kind),
    `the route looks up "${kind}" but late-bound-boot.ts registers only ${registered.join(", ")} — an unregistered kind throws at runtime, where no type checker can see it`
  );
});

/** Resolve a relative import from one source file to a real file under app/. Returns null
 *  for a package import, an alias we do not follow, or a path with no file on disk. */
function resolveImport(fromFile: string, spec: string): string | null {
  let target: string | null = null;
  if (spec.startsWith(".")) target = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith("@/")) target = path.resolve(repoRoot, spec.slice(2));
  if (!target) return null;
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, path.join(target, "index.ts")]) {
    if (existsSync(candidate) && candidate.endsWith(".ts")) return candidate;
    if (existsSync(candidate) && candidate.endsWith(".tsx")) return candidate;
  }
  // `./foo.ts` written with the extension already.
  return existsSync(target) ? target : null;
}

/** Every first-party module reachable from `entry`, STATIC imports and dynamic `import()`
 *  alike — which is what the repo's own perf budget counts, because Next compiles a
 *  route's whole graph on first hit with no tree-shaking. `import type` is erased before
 *  bundling and is deliberately excluded. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      /* a path we resolved but cannot read is not on the graph — treat it as a leaf. */
      continue;
    }
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const specs = [
      ...[...code.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]),
      // A re-export is a real edge: `export { X } from "./y"` evaluates ./y exactly as an
      // import does, and tasks.ts has one (`./tasks-window`). Missing it would be a FALSE
      // PASS below, which is the only failure mode a negative assertion really has.
      ...[...code.matchAll(/^\s*export\s+(?!type\b)(?:\*|\{[^}]*\})\s+from\s+"([^"]+)"/gm)].map((m) => m[1]),
      ...[...code.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
    ];
    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

test("the topic runner is NOT on app/_lib/tasks.ts's import graph", () => {
  const tasks = path.join(libDir, "tasks.ts");
  const graph = importGraph(tasks);
  // Non-vacuity: the walk really reached the hub's own dependencies. Without this a
  // broken resolver would report an empty graph and pass for the wrong reason.
  assert.ok(graph.size > 40, `the import walk found only ${graph.size} modules from tasks.ts — the resolver is broken`);
  assert.ok(graph.has(path.join(libDir, "task-external-runners.ts")), "sanity: tasks.ts does reach the leaf registry");
  for (const off of [
    path.join(here, "intake-topics.ts"),
    path.join(here, "types.ts"),
    path.join(libDir, "db", "intake-events.ts"),
    path.join(libDir, "late-bound-boot.ts"),
  ]) {
    assert.equal(
      graph.has(off),
      false,
      `${path.relative(repoRoot, off)} is reachable from app/_lib/tasks.ts — the hub is imported by ~60 routes, which is the cost this seam exists to avoid`
    );
  }
});

test("the runner's implementation is loaded LAZILY, so boot pays for nothing it does not run", () => {
  const boot = readFileSync(path.join(libDir, "late-bound-boot.ts"), "utf8");
  const code = boot.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const staticImports = [...code.matchAll(/^\s*import\s[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
  for (const spec of ["./journey/intake-topics", "./db/intake-events"]) {
    assert.equal(staticImports.includes(spec), false, `${spec} must be a dynamic import inside the runner`);
    assert.ok(code.includes(`import("${spec}")`), `${spec} must be reached through a lazy import()`);
  }
});
