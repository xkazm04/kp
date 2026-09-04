// The layout half of the diagram chain shipped with no test at all — including
// `isDiagramTooLarge`, the guard whose ONLY job is to stop an oversized paste
// from handing ELK a graph big enough to freeze the tab (bb6e89fd). A guard with
// no test is a guard that can be refactored to `false` in silence.
//
// These pin three things:
//   1. the ceiling fires AT the documented limits (and not one node earlier),
//   2. the node count walks nested containers (the count `isDiagramTooLarge`
//      compares against is a tree walk, not `roots.length`),
//   3. `layoutDiagram` returns ABSOLUTE coordinates — a child inside a container
//      is offset by its parent's origin, which is the whole reason `walk()`
//      accumulates (ox, oy).
//   npm run test:unit -- app/_components/puml/layout.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDiagramTooLarge, layoutDiagram, MAX_DIAGRAM_EDGES, MAX_DIAGRAM_NODES } from "./layout.ts";
import { parsePuml, type PumlDiagram } from "./parse.ts";

/** A diagram with `n` top-level leaves and `edges` edges between the first two. */
function synth(n: number, edges: number): PumlDiagram {
  const src = [
    "@startuml",
    ...Array.from({ length: n }, (_, i) => `component "N${i}" as n${i}`),
    ...Array.from({ length: edges }, (_, i) => `n${i % Math.max(n, 1)} --> n${(i + 1) % Math.max(n, 1)}`),
    "@enduml",
  ].join("\n");
  return parsePuml(src);
}

test("isDiagramTooLarge fires only above the documented ceilings", () => {
  assert.equal(isDiagramTooLarge(synth(MAX_DIAGRAM_NODES, 0)), false, "at the node ceiling is still fine");
  assert.equal(isDiagramTooLarge(synth(MAX_DIAGRAM_NODES + 1, 0)), true, "one node over must refuse");

  const atEdges = synth(4, MAX_DIAGRAM_EDGES);
  assert.equal(atEdges.edges.length, MAX_DIAGRAM_EDGES);
  assert.equal(isDiagramTooLarge(atEdges), false, "at the edge ceiling is still fine");
  assert.equal(isDiagramTooLarge(synth(4, MAX_DIAGRAM_EDGES + 1)), true, "one edge over must refuse");
});

test("the node count walks into containers (nesting is not free)", () => {
  // 3 containers + 149 leaves = 152 elements, but only 149 leaf boxes: the guard
  // counts BOTH, because ELK lays out containers too.
  const nested = parsePuml(
    [
      "@startuml",
      'package "Outer" as outer {',
      'package "Inner" as inner {',
      ...Array.from({ length: MAX_DIAGRAM_NODES - 2 }, (_, i) => `component "D${i}" as d${i}`),
      "}",
      "}",
      "@enduml",
    ].join("\n")
  );
  assert.equal(nested.roots.length, 1, "one root container");
  assert.equal(isDiagramTooLarge(nested), false, "exactly at the ceiling: 2 containers + 148 leaves");

  const overflowing = parsePuml(
    [
      "@startuml",
      'package "Outer" as outer {',
      'package "Inner" as inner {',
      ...Array.from({ length: MAX_DIAGRAM_NODES - 1 }, (_, i) => `component "D${i}" as d${i}`),
      "}",
      "}",
      "@enduml",
    ].join("\n")
  );
  assert.equal(overflowing.roots.length, 1, "still one root — a shallow count would miss this");
  assert.equal(isDiagramTooLarge(overflowing), true);
});

test("layoutDiagram gives containers and their children absolute coordinates", async () => {
  const diagram = parsePuml(
    [
      "@startuml",
      "title Small fixture",
      'package "Group" as grp {',
      '  component "Alpha" as a',
      '  component "Beta" as b',
      "}",
      'component "Outside" as c',
      "a --> b",
      "b --> c",
      "@enduml",
    ].join("\n")
  );

  const laid = await layoutDiagram(diagram);

  assert.equal(laid.title, "Small fixture");
  assert.ok(laid.width > 0 && laid.height > 0, "the root must be sized");
  assert.deepEqual(
    laid.containers.map((n) => n.id).sort(),
    ["grp"],
    "the package is a container box, drawn behind"
  );
  assert.deepEqual(laid.nodes.map((n) => n.id).sort(), ["a", "b", "c"]);
  assert.equal(laid.edges.length, 2);

  const grp = laid.containers[0];
  const alpha = laid.nodes.find((n) => n.id === "a")!;
  const beta = laid.nodes.find((n) => n.id === "b")!;

  // The absolute-coordinate contract: a child sits INSIDE its parent's box in
  // page space. Before (ox, oy) accumulation this held only for depth-1 roots.
  for (const child of [alpha, beta]) {
    assert.ok(child.x >= grp.x, `${child.id}.x ${child.x} must be inside the group at ${grp.x}`);
    assert.ok(child.y >= grp.y, `${child.id}.y ${child.y} must be inside the group at ${grp.y}`);
    assert.ok(child.x + child.w <= grp.x + grp.w + 1e-6, `${child.id} must not overflow the group's right edge`);
    assert.ok(child.y + child.h <= grp.y + grp.h + 1e-6, `${child.id} must not overflow the group's bottom edge`);
    assert.ok(child.w > 0 && child.h > 0);
  }

  // Every edge point is absolute too — a bend point left relative to a container
  // would draw the arrow in the wrong half of the canvas.
  for (const edge of laid.edges) {
    assert.ok(edge.points.length >= 2, "an edge needs at least a start and an end point");
    for (const p of edge.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= 0 && p.y >= 0, "absolute coordinates are never negative in a root-anchored layout");
    }
  }
});
