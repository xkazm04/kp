// A small, dependency-free PlantUML *component-diagram* parser. It turns the
// subset of PlantUML we author for our own diagrams into a plain graph model
// (nodes, nested containers, edges, notes) that the layout + SVG renderer can
// position and draw with full control over styling.
//
// Supported syntax:
//   @startuml [name] ... @enduml          (bounds; name ignored)
//   title <single line>                   (diagram title)
//   skinparam ... { ... }                 (ignored — we own the styling)
//   package | rectangle | frame | node | folder | database | cloud "Name" [<<s>>] [as id] {
//       ... nested elements ...
//   }
//   [Component label\nsecond line] [<<stereotype>>] [as id]
//   actor|database|cloud|folder|node|component|interface|queue "Label" [<<s>>] [as id]
//   a --> b : label        (solid arrow)     a ..> b        (dashed/dotted)
//   a <-- b                (reversed)         a -- b / a .. b (undirected)
//   directional + colored arrows (-down->, -[#aaa]->, etc.) are normalized
//   note (top|bottom|left|right) of <id> ... end note   (attached annotation)
//
// Labels are allowed to contain "->" etc. because bracketed/quoted spans are
// masked out before a line is classified as an edge.

export type PumlNodeKind =
  | "component"
  | "actor"
  | "database"
  | "cloud"
  | "folder"
  | "node"
  | "interface"
  | "queue"
  | "note";

export type PumlContainerKind = "package" | "rectangle" | "frame" | "node" | "folder" | "database" | "cloud";

export interface PumlNode {
  type: "node";
  id: string;
  label: string;
  kind: PumlNodeKind;
  stereotype?: string;
}

export interface PumlContainer {
  type: "container";
  id: string;
  label: string;
  kind: PumlContainerKind;
  stereotype?: string;
  children: PumlElement[];
}

export type PumlElement = PumlNode | PumlContainer;

export interface PumlEdge {
  source: string;
  target: string;
  style: "solid" | "dashed";
  /** true when neither end carried an arrowhead (`--` / `..`). */
  undirected: boolean;
  label?: string;
}

export interface PumlDiagram {
  title?: string;
  /** Honors PlantUML's `left to right direction` directive. */
  direction: "DOWN" | "RIGHT";
  roots: PumlElement[];
  edges: PumlEdge[];
  /** Flat lookup of every node + container by canonical id. */
  index: Map<string, PumlElement>;
}

const NL = ""; // placeholder for an escaped "\n" inside a label
const MASK = ""; // fill char for masked bracket / quote spans

const CONTAINER_KEYWORDS = new Set(["package", "rectangle", "frame", "node", "folder", "database", "cloud"]);
const LEAF_KEYWORDS: Record<string, PumlNodeKind> = {
  actor: "actor",
  database: "database",
  cloud: "cloud",
  folder: "folder",
  node: "node",
  component: "component",
  interface: "interface",
  queue: "queue",
};

/** Replace `[...]` and `"..."` spans with same-length runs of MASK so arrows
 *  inside labels are not mistaken for edges. Lengths are preserved so indices
 *  found in the masked string map back onto the original. */
function maskSpans(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "[" || ch === '"') {
      const close = ch === "[" ? "]" : '"';
      const end = line.indexOf(close, i + 1);
      if (end !== -1) {
        out += MASK.repeat(end - i + 1);
        i = end + 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function cleanLabel(raw: string): string {
  return raw.replace(new RegExp(NL, "g"), "\n").replace(/\\n/g, "\n").trim();
}

/** A key used to resolve `[Label]` / bare-token edge endpoints to a node id. */
function keyOf(text: string): string {
  return cleanLabel(text).replace(/\s+/g, " ").toLowerCase();
}

type ParseState = {
  diagram: PumlDiagram;
  stack: PumlContainer[]; // current open containers
  aliases: Map<string, string>; // alias / label key -> canonical id
  counter: { n: number };
};

function currentChildren(state: ParseState): PumlElement[] {
  const top = state.stack[state.stack.length - 1];
  return top ? top.children : state.diagram.roots;
}

function register(state: ParseState, el: PumlElement, alias: string | undefined, label: string) {
  state.diagram.index.set(el.id, el);
  if (alias) state.aliases.set(alias.toLowerCase(), el.id);
  const k = keyOf(label);
  if (k && !state.aliases.has(k)) state.aliases.set(k, el.id);
}

/** Pull a trailing `<<stereotype>>` and `as alias` off a header fragment. */
function extractTrailers(s: string): { rest: string; stereotype?: string; alias?: string } {
  let rest = s.trim();
  let stereotype: string | undefined;
  let alias: string | undefined;

  const asMatch = /\bas\s+([A-Za-z_][\w]*)\s*$/.exec(rest);
  if (asMatch) {
    alias = asMatch[1];
    rest = rest.slice(0, asMatch.index).trim();
  }
  const stMatch = /<<\s*([^>]+?)\s*>>\s*$/.exec(rest);
  if (stMatch) {
    stereotype = stMatch[1].trim();
    rest = rest.slice(0, stMatch.index).trim();
  }
  // `as alias` can also appear *before* the stereotype; check once more.
  const asMatch2 = /\bas\s+([A-Za-z_][\w]*)\s*$/.exec(rest);
  if (!alias && asMatch2) {
    alias = asMatch2[1];
    rest = rest.slice(0, asMatch2.index).trim();
  }
  return { rest, stereotype, alias };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

function genId(state: ParseState): string {
  state.counter.n += 1;
  return `__n${state.counter.n}`;
}

function tryContainerOpen(line: string, state: ParseState): boolean {
  const masked = maskSpans(line);
  if (!masked.trimEnd().endsWith("{")) return false;
  const m = /^(\w+)\s+(.*)\{\s*$/.exec(line.trim());
  if (!m) return false;
  const keyword = m[1].toLowerCase();
  if (!CONTAINER_KEYWORDS.has(keyword)) return false;

  const { rest, stereotype, alias } = extractTrailers(m[2]);
  const label = cleanLabel(unquote(rest));
  const id = alias ?? genId(state);
  const container: PumlContainer = {
    type: "container",
    id,
    label,
    kind: keyword as PumlContainerKind,
    stereotype,
    children: [],
  };
  currentChildren(state).push(container);
  register(state, container, alias, label);
  state.stack.push(container);
  return true;
}

function tryLeaf(line: string, state: ParseState): boolean {
  const trimmed = line.trim();

  // [Component label] <<s>> as id
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return false;
    const inner = trimmed.slice(1, end);
    const { stereotype, alias } = extractTrailers(trimmed.slice(end + 1));
    const label = cleanLabel(inner);
    const id = alias ?? genId(state);
    const node: PumlNode = { type: "node", id, label, kind: "component", stereotype };
    currentChildren(state).push(node);
    register(state, node, alias, label);
    return true;
  }

  // keyword "Label" <<s>> as id   (no trailing brace — handled earlier)
  const m = /^(\w+)\s+(.*)$/.exec(trimmed);
  if (m && LEAF_KEYWORDS[m[1].toLowerCase()]) {
    const kind = LEAF_KEYWORDS[m[1].toLowerCase()];
    const { rest, stereotype, alias } = extractTrailers(m[2]);
    const label = cleanLabel(unquote(rest));
    const id = alias ?? genId(state);
    const node: PumlNode = { type: "node", id, label, kind, stereotype };
    currentChildren(state).push(node);
    register(state, node, alias, label);
    return true;
  }
  return false;
}

// A PlantUML connector: optional "<" head, a run of "-" (solid) or "." (dashed),
// optional ">" tail. Covers the forms our diagrams use: -> --> ..> <-- <-> -- ..
// Bracket/quote spans are masked before this runs, so "->" inside a label is safe.
const ARROW_RE = /(<?)([-.]+)(>?)/;

function resolveEndpoint(token: string, state: ParseState): string {
  let t = token.trim();
  // strip a leading/trailing bracket or quote pair
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  t = unquote(t);
  const key = keyOf(t);
  const byAlias = state.aliases.get(t.toLowerCase());
  if (byAlias) return byAlias;
  const byKey = state.aliases.get(key);
  if (byKey) return byKey;
  // Implicit node — PlantUML auto-creates components referenced by an edge.
  const id = genId(state);
  const node: PumlNode = { type: "node", id, label: cleanLabel(t), kind: "component" };
  state.diagram.roots.push(node);
  register(state, node, undefined, cleanLabel(t));
  return id;
}

function tryEdge(line: string, state: ParseState): boolean {
  // Mask brackets/quotes (length preserved) so positions map back to `line`.
  const masked = maskSpans(line);
  const m = ARROW_RE.exec(masked);
  if (!m) return false;
  const [whole, head, body, tail] = m;
  // Require a genuine connector: an arrowhead, or a 2+ char dash/dot run. This
  // rejects a stray "." or "-" that is part of a token rather than an edge.
  if (head !== "<" && tail !== ">" && body.length < 2) return false;

  const start = m.index;
  const leftRaw = line.slice(0, start).trim();
  let rightRaw = line.slice(start + whole.length);

  // A trailing ": label" (top level, i.e. visible in the masked text) is the
  // edge label.
  let label: string | undefined;
  const colon = maskSpans(rightRaw).indexOf(":");
  if (colon !== -1) {
    label = rightRaw.slice(colon + 1).trim() || undefined;
    rightRaw = rightRaw.slice(0, colon);
  }
  rightRaw = rightRaw.trim();
  if (!leftRaw || !rightRaw) return false;

  const reversed = head === "<" && tail !== ">";
  const style: PumlEdge["style"] = body.includes(".") ? "dashed" : "solid";
  const undirected = head !== "<" && tail !== ">";

  const leftId = resolveEndpoint(leftRaw, state);
  const rightId = resolveEndpoint(rightRaw, state);
  const [source, target] = reversed ? [rightId, leftId] : [leftId, rightId];

  state.diagram.edges.push({ source, target, style, undirected, label: label ? cleanLabel(label) : undefined });
  return true;
}

export function parsePuml(source: string): PumlDiagram {
  const diagram: PumlDiagram = { direction: "DOWN", roots: [], edges: [], index: new Map() };
  const state: ParseState = { diagram, stack: [], aliases: new Map(), counter: { n: 0 } };

  // Normalize escaped newlines up front so labels survive masking.
  const lines = source.replace(/\r\n/g, "\n").replace(/\\n/g, NL).split("\n");

  let skinDepth = 0; // brace depth while skipping a skinparam {...} block

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (skinDepth > 0) {
      skinDepth += (trimmed.match(/\{/g)?.length ?? 0) - (trimmed.match(/\}/g)?.length ?? 0);
      continue;
    }
    if (trimmed === "" || trimmed.startsWith("'")) continue; // blank / comment
    if (/^@startuml\b/i.test(trimmed) || /^@enduml\b/i.test(trimmed)) continue;

    if (/^skinparam\b/i.test(trimmed)) {
      if (maskSpans(trimmed).includes("{")) skinDepth = 1;
      continue;
    }
    if (/^left to right direction$/i.test(trimmed)) {
      diagram.direction = "RIGHT";
      continue;
    }
    if (/^top to bottom direction$/i.test(trimmed)) {
      diagram.direction = "DOWN";
      continue;
    }
    // Other directives we don't need but should not treat as nodes.
    if (/^(scale|hide\b|allow_mixing|!|autonumber)/i.test(trimmed)) {
      continue;
    }

    const titleMatch = /^title\s+(.*)$/i.exec(trimmed);
    if (titleMatch) {
      diagram.title = cleanLabel(titleMatch[1]);
      continue;
    }

    // note (pos) of <id> [: text] ... end note
    const noteMatch = /^note\s+(?:(top|bottom|left|right)\s+of\s+)?([A-Za-z_][\w]*)?\s*(?::\s*(.*))?$/i.exec(trimmed);
    if (/^note\b/i.test(trimmed) && noteMatch) {
      let text = noteMatch[3] ?? "";
      if (!noteMatch[3]) {
        i += 1;
        const body: string[] = [];
        while (i < lines.length && !/^end\s*note\s*$/i.test(lines[i].trim())) {
          body.push(lines[i].trim());
          i += 1;
        }
        text = body.join("\n");
      }
      const anchor = noteMatch[2];
      const id = genId(state);
      const node: PumlNode = { type: "node", id, label: cleanLabel(text), kind: "note" };
      diagram.roots.push(node);
      diagram.index.set(id, node);
      if (anchor) {
        const anchorId = state.aliases.get(anchor.toLowerCase());
        if (anchorId) diagram.edges.push({ source: anchorId, target: id, style: "dashed", undirected: true });
      }
      continue;
    }
    if (/^end\s*note\s*$/i.test(trimmed)) continue;

    if (trimmed === "}") {
      state.stack.pop();
      continue;
    }

    if (tryContainerOpen(line, state)) continue;
    if (tryLeaf(line, state)) continue;
    if (tryEdge(line, state)) continue;
    // Unrecognized line: ignore rather than throw, so partial diagrams render.
  }

  return diagram;
}
