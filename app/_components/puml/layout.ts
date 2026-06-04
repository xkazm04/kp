// Turns a parsed PumlDiagram into absolutely-positioned shapes by delegating
// layout to elkjs (layered, top-down, orthogonal edges). We only ask ELK for
// coordinates — every pixel of styling is drawn by our own SVG renderer.
//
// elkjs is imported dynamically so it never loads during SSR (the diagram is
// laid out in a client effect after mount).

import type { ElkNode, ElkExtendedEdge, ElkLabel } from "elkjs/lib/elk-api";
import type { PumlContainer, PumlDiagram, PumlElement, PumlNodeKind } from "./parse";
import { LINE_H, NODE_FONT, TITLE_FONT } from "./constants";
import { measure, measureLines } from "./measure";

const PAD_X = 13;
const PAD_Y = 9;

export interface Box {
  id: string;
  kind: PumlNodeKind | PumlContainer["kind"];
  label: string;
  lines: string[];
  stereotype?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PositionedEdge {
  id: string;
  points: { x: number; y: number }[];
  style: "solid" | "dashed";
  undirected: boolean;
  label?: string;
  labelBox?: { x: number; y: number; w: number; h: number };
}

export interface PositionedDiagram {
  width: number;
  height: number;
  title?: string;
  nodes: Box[]; // leaf shapes (drawn on top)
  containers: Box[]; // group boxes (drawn behind)
  edges: PositionedEdge[];
}

/** Compute the box size for a leaf node from its (multi-line) label + kind. */
function sizeLeaf(label: string, kind: PumlNodeKind): { w: number; h: number; lines: string[] } {
  const lines = label.length ? label.split("\n") : [""];
  const textW = measureLines(lines, NODE_FONT);
  const textH = lines.length * LINE_H;

  switch (kind) {
    case "actor":
      return { w: Math.max(textW + 12, 64), h: textH + 30, lines };
    case "database":
      return { w: Math.max(textW + PAD_X * 2 + 6, 96), h: textH + PAD_Y * 2 + 14, lines };
    case "cloud":
      return { w: Math.max(textW + PAD_X * 2 + 26, 104), h: textH + PAD_Y * 2 + 16, lines };
    case "note":
      return { w: Math.max(textW + PAD_X * 2 + 6, 90), h: textH + PAD_Y * 2, lines };
    case "folder":
      return { w: Math.max(textW + PAD_X * 2, 96), h: textH + PAD_Y * 2 + 8, lines };
    default:
      return { w: Math.max(textW + PAD_X * 2, 92), h: textH + PAD_Y * 2, lines };
  }
}

function toElk(el: PumlElement): ElkNode {
  if (el.type === "container") {
    const titleW = measure(el.label, TITLE_FONT) + 34;
    return {
      id: el.id,
      labels: [{ text: el.label, width: titleW, height: 20 } as ElkLabel],
      layoutOptions: {
        "elk.padding": "[top=40,left=16,bottom=16,right=16]",
        "elk.spacing.nodeNode": "22",
        "elk.nodeSize.constraints": "NODE_LABELS MINIMUM_SIZE",
        "elk.nodeLabels.placement": "H_LEFT V_TOP INSIDE",
      },
      children: [], // populated by toElkWithEdges so edges land in their LCA
    };
  }
  const { w, h } = sizeLeaf(el.label, el.kind);
  return { id: el.id, width: w, height: h };
}

const ROOT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "22",
  "elk.spacing.nodeNode": "22",
  "elk.spacing.edgeNode": "16",
  "elk.spacing.edgeEdge": "10",
  "elk.layered.spacing.edgeNodeBetweenLayers": "14",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.padding": "[top=8,left=8,bottom=8,right=8]",
} as const;

const ROOT_ID = "__root";

/** Map every node/container to its parent container id (ROOT_ID at top level). */
function buildParentMap(diagram: PumlDiagram): Map<string, string> {
  const parent = new Map<string, string>();
  const index = (els: PumlElement[], parentId: string) => {
    for (const el of els) {
      parent.set(el.id, parentId);
      if (el.type === "container") index(el.children, el.id);
    }
  };
  index(diagram.roots, ROOT_ID);
  return parent;
}

export async function layoutDiagram(diagram: PumlDiagram): Promise<PositionedDiagram> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();

  // Place each edge in the lowest common ancestor of its endpoints. Keeping
  // edges out of the root (when they belong to a container) stops ELK from
  // inflating unrelated containers with edge-routing space under
  // INCLUDE_CHILDREN — the difference between snug and balloon-tall boxes.
  const parent = buildParentMap(diagram);
  const ancestors = (id: string): string[] => {
    const chain: string[] = [];
    let p = parent.get(id);
    while (p && p !== ROOT_ID) {
      chain.push(p);
      p = parent.get(p);
    }
    chain.push(ROOT_ID);
    return chain;
  };
  const lca = (a: string, b: string): string => {
    const bSet = new Set(ancestors(b));
    for (const x of ancestors(a)) if (bSet.has(x)) return x;
    return ROOT_ID;
  };

  const edgesByContainer = new Map<string, ElkExtendedEdge[]>();
  diagram.edges.forEach((e, i) => {
    const elkEdge: ElkExtendedEdge = { id: `e${i}`, sources: [e.source], targets: [e.target] };
    if (e.label) {
      elkEdge.labels = [{ text: e.label, width: measure(e.label, TITLE_FONT) + 12, height: 20 } as ElkLabel];
    }
    const owner = lca(e.source, e.target);
    const bucket = edgesByContainer.get(owner);
    if (bucket) bucket.push(elkEdge);
    else edgesByContainer.set(owner, [elkEdge]);
  });

  const toElkWithEdges = (el: PumlElement): ElkNode => {
    const node = toElk(el);
    if (el.type === "container") {
      node.children = el.children.map(toElkWithEdges);
      node.edges = edgesByContainer.get(el.id) ?? [];
    }
    return node;
  };

  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...ROOT_OPTIONS, "elk.direction": diagram.direction },
    children: diagram.roots.map(toElkWithEdges),
    edges: edgesByContainer.get(ROOT_ID) ?? [],
  };

  const res = await elk.layout(graph);

  const nodes: Box[] = [];
  const containers: Box[] = [];
  const edges: PositionedEdge[] = [];
  const meta = new Map<string, PumlElement>(diagram.index);

  // Walk the laid-out tree. Coordinates in ELK are relative to the parent's
  // top-left, so (ox, oy) accumulates each container's origin to give absolute
  // positions for nodes, container boxes, and edge points alike.
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const e of node.edges ?? []) {
      const idx = Number(e.id?.slice(1) ?? -1);
      const original = diagram.edges[idx];
      const section = e.sections?.[0];
      const points = section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
            x: p.x + ox,
            y: p.y + oy,
          }))
        : [];
      const lab = e.labels?.[0];
      edges.push({
        id: e.id ?? `e${idx}`,
        points,
        style: original?.style ?? "solid",
        undirected: original?.undirected ?? false,
        label: original?.label,
        labelBox:
          lab && lab.x != null && lab.y != null
            ? { x: lab.x + ox, y: lab.y + oy, w: lab.width ?? 0, h: lab.height ?? 0 }
            : undefined,
      });
    }

    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      const src = meta.get(child.id);
      const isContainer = src?.type === "container" || (child.children?.length ?? 0) > 0;
      const box: Box = {
        id: child.id,
        kind: (src?.type === "container" ? src.kind : src?.kind) ?? "component",
        label: src?.label ?? "",
        lines: (src?.label ?? "").split("\n"),
        stereotype: src?.stereotype,
        x,
        y,
        w: child.width ?? 0,
        h: child.height ?? 0,
      };
      if (isContainer) {
        containers.push(box);
        walk(child, x, y);
      } else {
        nodes.push(box);
      }
    }
  };
  walk(res, 0, 0);

  return {
    width: res.width ?? 0,
    height: res.height ?? 0,
    title: diagram.title,
    nodes,
    containers,
    edges,
  };
}
