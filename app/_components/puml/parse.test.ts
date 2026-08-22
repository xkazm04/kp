// Regression tests for the PlantUML component-diagram parser. These pin the
// label-bracket bug fix (a label containing a bracketed token used to truncate
// at the first "]") and the create-and-register paths shared via addLeaf, both
// of which feed the ~25 hand-authored diagrams + the architecture .puml sources.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePuml } from "./parse.ts";
import { STEP_DETAILS } from "../../diagrams/pipelineSteps.ts";

// app/_components/puml/ -> repo root (three levels up).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Helper: parse a one-element body wrapped in @startuml/@enduml and return the
// node registered under `alias`. In a template literal "\\n" is the two-char
// escaped-newline sequence a real .puml source carries.
function nodeByAlias(body: string, alias: string) {
  const d = parsePuml(`@startuml\n${body}\n@enduml`);
  const el = d.index.get(alias);
  if (!el) assert.fail(`no element registered under alias "${alias}"`);
  return el;
}

// ---------------------------------------------------------------------------
// Bracketed labels keep their REAL closing bracket (depth-aware match)
// ---------------------------------------------------------------------------

test("bracket-leaf: a nested route token keeps its closing bracket", () => {
  // The shipped diagrams [Candidate portal /interview/[token]] used to render as
  // /interview/[token (closing bracket dropped at the first inner "]").
  const node = nodeByAlias("[Candidate portal\\n/interview/[token]] <<auto>> as portal", "portal");
  assert.equal(node.label, "Candidate portal\n/interview/[token]");
  assert.equal(node.stereotype, "auto");
  assert.equal(node.kind, "component");
});

test("bracket-leaf: nested token with an alias-only trailer (no stereotype)", () => {
  const node = nodeByAlias("[POST /api/offer/[token]] as api", "api");
  assert.equal(node.label, "POST /api/offer/[token]");
  assert.equal(node.stereotype, undefined);
});

test("bracket-leaf: a plain label without nesting is unchanged", () => {
  const node = nodeByAlias("[Plain label] as plain", "plain");
  assert.equal(node.label, "Plain label");
});

test("bracket-leaf: a label with two nested groups matches the outermost bracket", () => {
  const node = nodeByAlias("[A [x] mid [y] end] as z", "z");
  assert.equal(node.label, "A [x] mid [y] end");
});

// An unterminated bracket is not a leaf — the line falls through untouched.
test("bracket-leaf: an unclosed bracket is not parsed as a node", () => {
  const d = parsePuml("@startuml\n[never closed\n@enduml");
  assert.equal(d.roots.length, 0);
});

// ---------------------------------------------------------------------------
// addLeaf paths: keyword leaves and aliasing still register correctly
// ---------------------------------------------------------------------------

test("keyword-leaf: a quoted database label + alias registers", () => {
  const node = nodeByAlias('database "jobs · requirements" as jobs', "jobs");
  assert.equal(node.kind, "database");
  assert.equal(node.label, "jobs · requirements");
});

test("a bracket label resolves an edge endpoint by its label key", () => {
  const d = parsePuml(`@startuml
[Candidate portal\\n/offer/[token]] as portal
[Hired] as hired
portal --> hired : accept
@enduml`);
  assert.equal(d.edges.length, 1);
  assert.equal(d.edges[0].source, "portal");
  assert.equal(d.edges[0].target, "hired");
});

// ---------------------------------------------------------------------------
// Pruned vocabulary (idea-12897bcc): the parser only accepts the kinds the
// committed diagrams actually use. Speculative kinds that rendered identically
// to a generic box were dropped; these tests are the contract that proves the
// supported subset is honest and catches any silent re-introduction.
// ---------------------------------------------------------------------------

// The kinds the renderer (PlantUml.tsx) gives a distinct shape, all still parsed.
const KEPT_LEAVES: [string, string][] = [
  ['actor "A" as a', "actor"],
  ['database "D" as a', "database"],
  ['cloud "C" as a', "cloud"],
  ['folder "F" as a', "folder"],
  ['component "X" as a', "component"],
  ["[Bracketed] as a", "component"],
];
for (const [body, kind] of KEPT_LEAVES) {
  test(`kept leaf kind: \`${body}\` parses as ${kind}`, () => {
    const el = nodeByAlias(body, "a");
    assert.equal(el.type, "node");
    assert.equal(el.kind, kind);
  });
}

// The kept container keywords still open a container (drawn as a group box).
for (const keyword of ["package", "database", "folder"]) {
  test(`kept container kind: \`${keyword} "G" { ... }\` opens a container`, () => {
    const d = parsePuml(`@startuml\n${keyword} "G" as g {\n[Inner] as inner\n}\n@enduml`);
    const g = d.index.get("g");
    if (!g) assert.fail(`no container registered under "g"`);
    assert.equal(g.type, "container");
    assert.equal(g.kind, keyword);
    assert.equal(d.index.get("inner")?.type, "node");
  });
}

// Pruned leaf keywords are no longer special — they parse as nothing (the line
// is unrecognized and ignored), so a stray `interface`/`queue`/`node "..."` no
// longer fabricates a phantom box.
for (const keyword of ["interface", "queue", "node"]) {
  test(`pruned leaf keyword: \`${keyword} "X"\` produces no node`, () => {
    const d = parsePuml(`@startuml\n${keyword} "X" as x\n@enduml`);
    assert.equal(d.roots.length, 0, `${keyword} should not create a node`);
    assert.equal(d.index.get("x"), undefined);
  });
}

// Pruned container keywords no longer open a container; the keyword line is
// ignored and any inner declarations fall through to the diagram roots.
for (const keyword of ["rectangle", "frame", "node", "cloud"]) {
  test(`pruned container keyword: \`${keyword} "G" { ... }\` opens no container`, () => {
    const d = parsePuml(`@startuml\n${keyword} "G" as g {\n[Inner] as inner\n}\n@enduml`);
    const containers = [...d.index.values()].filter((el) => el.type === "container");
    assert.equal(containers.length, 0, `${keyword} must not open a container`);
    // `[Inner]` falls through to the roots rather than being nested in a group.
    const inner = d.index.get("inner");
    assert.equal(inner?.type, "node");
    assert.ok(d.roots.includes(inner!), "inner should be a top-level root, not nested");
  });
}

// ---------------------------------------------------------------------------
// Strict mode: no phantom nodes (idea-bf583bb5). In a declared-only diagram a
// mistyped edge endpoint must be recorded + the edge dropped, NOT fabricated into
// a disconnected ghost box that becomes a dead click target in the funnel.
// ---------------------------------------------------------------------------

test("non-strict (default) keeps PlantUML auto-vivification but records the endpoint", () => {
  const d = parsePuml(`@startuml\n[Real] as real\nreal --> ghost\n@enduml`);
  // Legacy behavior preserved: 'ghost' is fabricated so the edge still connects
  // (class diagrams render purely from such endpoints) — but it's now recorded.
  assert.equal(d.edges.length, 1);
  assert.ok([...d.index.values()].some((el) => el.label === "ghost"));
  assert.deepEqual(d.unresolvedEndpoints, ["ghost"]);
});

test("strict mode records the unresolved endpoint and drops the edge — no phantom", () => {
  const d = parsePuml(`@startuml\n[Real] as real\nreal --> ghsot\n@enduml`, { strict: true });
  assert.deepEqual(d.unresolvedEndpoints, ["ghsot"]);
  assert.equal(d.edges.length, 0, "no edge to a phantom node");
  assert.ok(![...d.index.values()].some((el) => el.label === "ghsot"), "no phantom node fabricated");
});

test("strict mode keeps edges whose endpoints all resolve", () => {
  const d = parsePuml(`@startuml\n[A] as a\n[B] as b\na --> b\n@enduml`, { strict: true });
  assert.equal(d.unresolvedEndpoints.length, 0);
  assert.equal(d.edges.length, 1);
});

test("strict mode dedupes a repeated unresolved endpoint", () => {
  const d = parsePuml(`@startuml\n[A] as a\na --> ghost\nghost --> a\n@enduml`, { strict: true });
  assert.deepEqual(d.unresolvedEndpoints, ["ghost"]);
  assert.equal(d.edges.length, 0);
});

// ---------------------------------------------------------------------------
// Directional / coloured connectors. parse.ts's header advertises `-down->` and
// `-[#aaa]->`, but ARROW_RE only ever saw the leading single "-": it failed the
// "genuine connector" guard, so tryEdge returned false and the edge vanished with
// NO node, NO unresolvedEndpoints record and NO dev warning — the one failure mode
// the strict-mode machinery exists to prevent. Prose that merely looks like one
// ("top-left-corner") must still NOT become an edge.
// ---------------------------------------------------------------------------

const DIRECTIONAL: [string, string][] = [
  ["-down->", "a -down-> b"],
  ["-up->", "a -up-> b"],
  ["-right->", "a -right-> b"],
  ["-[#aaa]->", "a -[#aaa]-> b"],
  ["..down.>", "a .down.> b"],
];
for (const [name, line] of DIRECTIONAL) {
  test(`directional connector: \`${name}\` still connects a -> b`, () => {
    const d = parsePuml(`@startuml\n[A] as a\n[B] as b\n${line}\n@enduml`, { strict: true });
    assert.deepEqual(d.unresolvedEndpoints, [], "endpoints must resolve to the declared nodes");
    assert.equal(d.edges.length, 1, "the edge must not be silently dropped");
    assert.equal(d.edges[0].source, "a");
    assert.equal(d.edges[0].target, "b");
    assert.equal(d.edges[0].undirected, false);
  });
}

test("directional connector: `<-down-` reverses instead of inventing a phantom node", () => {
  // Pre-fix this parsed as `a <- ` + an endpoint literally labelled "down- b".
  const d = parsePuml(`@startuml\n[A] as a\n[B] as b\na <-down- b\n@enduml`, { strict: true });
  assert.deepEqual(d.unresolvedEndpoints, []);
  assert.deepEqual(
    d.edges.map((e) => [e.source, e.target]),
    [["b", "a"]]
  );
});

test("a hyphenated word is NOT a connector (no arrowhead, no edge)", () => {
  for (const line of ["top-left-corner", "read-only cache", "a --down b", "co-located -- shared x"]) {
    const d = parsePuml(`@startuml\n[A] as a\n[B] as b\n${line}\n@enduml`, { strict: true });
    assert.equal(d.edges.length, 0, `"${line}" must not read as an edge`);
  }
});

// ---------------------------------------------------------------------------
// Unterminated `note` bodies: the section-break fallback (pinned so the linear
// lookahead memos in parsePuml can't quietly change WHERE a note body ends).
// ---------------------------------------------------------------------------

test("an unterminated note stops at the author's blank line, not at EOF", () => {
  const d = parsePuml(`@startuml
[A] as a
note right of a
body line

[B] as b
a --> b
@enduml`);
  // [B] and the edge survive: they were NOT swallowed into the note body.
  assert.equal(d.index.get("b")?.type, "node");
  assert.equal(d.edges.filter((e) => e.source === "a" && e.target === "b").length, 1);
  const note = [...d.index.values()].find((el) => el.type === "node" && el.kind === "note");
  assert.equal(note && note.type === "node" ? note.label : null, "body line");
});

test("consecutive unterminated notes each stop at their OWN section break", () => {
  const d = parsePuml(`@startuml
[A] as a
note right of a
first body

note left of a
second body

[B] as b
@enduml`);
  const notes = [...d.index.values()].filter((el) => el.type === "node" && el.kind === "note");
  assert.deepEqual(
    notes.map((n) => (n.type === "node" ? n.label : "")),
    ["first body", "second body"]
  );
  assert.equal(d.index.get("b")?.type, "node");
});

// ---------------------------------------------------------------------------
// Parse cost must stay LINEAR in the source. parsePuml runs inside PlantUml's
// render-phase useMemo, and Markdown renders EVERY ```puml fence in an
// operator-authored (or, on some surfaces, candidate-authored) body — so a
// quadratic scan here is a frozen tab, and isDiagramTooLarge cannot save it
// (that guard only runs on the already-parsed diagram). All three shapes below
// were O(n²) before the lookahead memos: 20k unterminated `note` lines cost
// ~7.1s, a 400k-char run of unclosed "[" ~4.9s, 30k distinct bad endpoints
// ~3.4s. Post-fix they are 23 / 12 / 84 ms; the budgets sit ~12-80x above that
// and ~3-5x below the pre-fix cost, so they only trip on a return to O(n²).
// ---------------------------------------------------------------------------

function parseMs(source: string, opts?: { strict?: boolean }): { ms: number; diagram: ReturnType<typeof parsePuml> } {
  const t0 = performance.now();
  const diagram = parsePuml(source, opts);
  return { ms: performance.now() - t0, diagram };
}

test("linear parse: 20k unterminated notes don't freeze the render-phase parse", () => {
  const src = `@startuml\n${Array.from({ length: 20000 }, () => "note x").join("\n")}\n@enduml`;
  const { ms, diagram } = parseMs(src);
  assert.equal(diagram.roots.length, 20000);
  assert.ok(ms < 1500, `took ${Math.round(ms)}ms — pre-fix ~7100ms (per-note EOF scan is back)`);
});

test("linear parse: a 400k-char run of unclosed brackets doesn't freeze maskSpans", () => {
  const src = `@startuml\n${"[".repeat(400_000)}\n@enduml`;
  const { ms, diagram } = parseMs(src);
  assert.equal(diagram.roots.length, 0, "an unclosed bracket is not a node");
  assert.ok(ms < 1000, `took ${Math.round(ms)}ms — pre-fix ~4900ms (per-opener indexOf rescan is back)`);
});

test("linear parse: 30k distinct unresolved endpoints are recorded in linear time", () => {
  const src = `@startuml\n${Array.from({ length: 30000 }, (_, k) => `a${k} --> b${k}`).join("\n")}\n@enduml`;
  const { ms, diagram } = parseMs(src, { strict: true });
  assert.equal(diagram.unresolvedEndpoints.length, 60000);
  assert.ok(ms < 1000, `took ${Math.round(ms)}ms — pre-fix ~3350ms (linear dedupe scan is back)`);
});

// The trust-critical guard: a typo in any interactive-funnel diagram (the funnel
// source + every per-step STEP_DETAILS diagram) would surface here as an
// unresolved endpoint, instead of shipping a confidently-wrong picture.
test("contract: the declared-only funnel diagrams have zero unresolved endpoints", () => {
  const sources: [string, string][] = [
    [
      "15-automated-pipeline-tobe.puml",
      readFileSync(path.resolve(ROOT, "docs/diagrams/15-automated-pipeline-tobe.puml"), "utf8"),
    ],
    ...Object.entries(STEP_DETAILS).map(([id, d]) => [`STEP_DETAILS.${id}`, d.puml] as [string, string]),
  ];
  const dirty = sources
    .map(([name, src]) => [name, parsePuml(src, { strict: true }).unresolvedEndpoints] as const)
    .filter(([, unresolved]) => unresolved.length > 0)
    .map(([name, unresolved]) => `${name}: ${unresolved.join(", ")}`);
  assert.deepEqual(dirty, [], `mistyped alias(es) in the interactive funnel:\n  ${dirty.join("\n  ")}`);
});
