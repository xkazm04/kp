// A small, dependency-free PlantUML *component-diagram* parser. It turns the
// subset of PlantUML we author for our own diagrams into a plain graph model
// (nodes, nested containers, edges, notes) that the layout + SVG renderer can
// position and draw with full control over styling.
//
// Supported syntax:
//   @startuml [name] ... @enduml          (bounds; name ignored)
//   title <single line>                   (diagram title)
//   skinparam ... { ... }                 (ignored — we own the styling)
//   package | database | folder "Name" [<<s>>] [as id] {
//       ... nested elements ...
//   }
//   [Component label\nsecond line] [<<stereotype>>] [as id]
//   actor|database|cloud|folder|component "Label" [<<s>>] [as id]
//
// The container/leaf keyword sets below are the HONEST subset the committed
// diagrams (docs/diagrams/*.puml + the inline STEP_DETAILS / About sources)
// actually use — speculative kinds that rendered identically to a generic box
// (leaf node/interface/queue; container rectangle/frame/node/cloud) were pruned
// so the parser surface matches the renderer's real capabilities. parse.test.ts
// pins this with the committed sources as proof the deletion is safe.
//   a --> b : label        (solid arrow)     a ..> b        (dashed/dotted)
//   a <-- b                (reversed)         a -- b / a .. b (undirected)
//   directional + colored arrows (-down->, -[#aaa]->, etc.) are normalized
//   note (top|bottom|left|right) of <id> ... end note   (attached annotation)
//
// Labels are allowed to contain "->" etc. because bracketed/quoted spans are
// masked out before a line is classified as an edge.

export type PumlNodeKind = "component" | "actor" | "database" | "cloud" | "folder" | "note";

export type PumlContainerKind = "package" | "database" | "folder";

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
  /** Edge endpoints that resolved to no declared alias/label (deduped). In a
   *  declared-only diagram these are typos; the strict-mode contract test asserts
   *  this is empty and the renderer warns in dev. See `resolveEndpoint`. */
  unresolvedEndpoints: string[];
}

const NL = ""; // placeholder for an escaped "\n" inside a label
const MASK = ""; // fill char for masked bracket / quote spans

const CONTAINER_KEYWORDS = new Set(["package", "database", "folder"]);
const LEAF_KEYWORDS: Record<string, PumlNodeKind> = {
  actor: "actor",
  database: "database",
  cloud: "cloud",
  folder: "folder",
  component: "component",
};

/** Replace `[...]` and `"..."` spans with same-length runs of MASK so arrows
 *  inside labels are not mistaken for edges. Lengths are preserved so indices
 *  found in the masked string map back onto the original. */
function maskSpans(line: string): string {
  let out = "";
  let i = 0;
  // Once a closing delimiter is absent from the rest of the line it is absent for
  // every LATER opener too, so remember that instead of re-scanning to end-of-line
  // per opener. Without the memo a line of N unclosed "[" costs O(N²) indexOf work
  // (400k chars ≈ 5s) — and maskSpans runs during the render-phase parse, so that
  // is a frozen tab, not a slow render.
  let noCloseBracket = false;
  let noCloseQuote = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "[" || ch === '"') {
      const isBracket = ch === "[";
      if (!(isBracket ? noCloseBracket : noCloseQuote)) {
        const end = line.indexOf(isBracket ? "]" : '"', i + 1);
        if (end !== -1) {
          out += MASK.repeat(end - i + 1);
          i = end + 1;
          continue;
        }
        if (isBracket) noCloseBracket = true;
        else noCloseQuote = true;
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
  /** Membership index for `diagram.unresolvedEndpoints` — the array stays the public
   *  shape, but the dedupe check must not be a linear scan (an edge block with many
   *  distinct bad endpoints made recording them O(n²)). */
  unresolvedSeen: Set<string>;
  counter: { n: number };
  /** When true, an edge endpoint that resolves to nothing is recorded and the
   *  edge dropped, instead of fabricating a phantom node (PlantUML-style
   *  auto-vivification). Used for declared-only diagrams (idea-bf583bb5). */
  strict: boolean;
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

/** Create a leaf node, attach it to the current container (the diagram roots at
 *  top level), and register its id under any alias + label key. This is the one
 *  place the create-and-register ritual lives, so the bracket-leaf, keyword-leaf
 *  and implicit-edge-endpoint paths can't drift apart (e.g. a new alias rule
 *  applied to one and missed in another). Returns the created node. */
function addLeaf(
  state: ParseState,
  attrs: { label: string; kind: PumlNodeKind; stereotype?: string; alias?: string }
): PumlNode {
  const id = attrs.alias ?? genId(state);
  const node: PumlNode = { type: "node", id, label: attrs.label, kind: attrs.kind, stereotype: attrs.stereotype };
  currentChildren(state).push(node);
  register(state, node, attrs.alias, attrs.label);
  return node;
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

/** Index of the "]" that closes the leading "[" of `s` (s[0] must be "["),
 *  tracking nesting depth so a label containing bracketed tokens — route params
 *  like /interview/[token], array access, generics — keeps its real closing
 *  bracket instead of truncating at the first inner "]". Returns -1 when the
 *  bracket is never closed (caller treats the line as a non-leaf). */
function closingBracket(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "[") depth += 1;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

function tryLeaf(line: string, state: ParseState): boolean {
  const trimmed = line.trim();

  // [Component label] <<s>> as id
  if (trimmed.startsWith("[")) {
    const end = closingBracket(trimmed);
    if (end === -1) return false;
    const inner = trimmed.slice(1, end);
    const { stereotype, alias } = extractTrailers(trimmed.slice(end + 1));
    addLeaf(state, { label: cleanLabel(inner), kind: "component", stereotype, alias });
    return true;
  }

  // keyword "Label" <<s>> as id   (no trailing brace — handled earlier)
  const m = /^(\w+)\s+(.*)$/.exec(trimmed);
  if (m && LEAF_KEYWORDS[m[1].toLowerCase()]) {
    const kind = LEAF_KEYWORDS[m[1].toLowerCase()];
    const { rest, stereotype, alias } = extractTrailers(m[2]);
    addLeaf(state, { label: cleanLabel(unquote(rest)), kind, stereotype, alias });
    return true;
  }
  return false;
}

// A PlantUML connector: optional "<" head, a run of "-" (solid) or "." (dashed),
// an OPTIONAL inline modifier (a direction word, or a `[#color]` span — already
// masked to MASK runs) that must be followed by a second dash/dot run, and an
// optional ">" tail. Covers the forms our diagrams use (-> --> ..> <-- <-> -- ..)
// plus the `-down->` / `-[#aaa]->` forms this file's header advertises: those used
// to match only the leading single "-", fail the connector guard below, and drop
// the whole edge SILENTLY (no node, no unresolvedEndpoints record, no dev warning).
// Bracket/quote spans are masked before this runs, so "->" inside a label is safe.
const ARROW_RE = new RegExp(`(<?)([-.]+)(?:(?:up|down|left|right|${MASK}+)([-.]+))?(>?)`, "i");

function resolveEndpoint(token: string, state: ParseState): string | null {
  let t = token.trim();
  // strip a leading/trailing bracket or quote pair
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  t = unquote(t);
  const key = keyOf(t);
  const byAlias = state.aliases.get(t.toLowerCase());
  if (byAlias) return byAlias;
  const byKey = state.aliases.get(key);
  if (byKey) return byKey;
  // Unresolved endpoint: record it (deduped) so callers can surface the likely
  // typo. In a declared-only diagram a stray endpoint is a mistyped alias, not an
  // intended node — strict mode drops the edge rather than fabricating a phantom
  // box that becomes a dead click target. Non-strict keeps PlantUML's legacy
  // auto-vivification (some class diagrams render purely from edge endpoints).
  const label = cleanLabel(t);
  if (!state.unresolvedSeen.has(label)) {
    state.unresolvedSeen.add(label);
    state.diagram.unresolvedEndpoints.push(label);
  }
  if (state.strict) return null;
  return addLeaf(state, { label, kind: "component" }).id;
}

function tryEdge(line: string, state: ParseState): boolean {
  // Mask brackets/quotes (length preserved) so positions map back to `line`.
  const masked = maskSpans(line);
  const m = ARROW_RE.exec(masked);
  if (!m) return false;
  const [whole, head, run1, run2, tail] = m;
  const body = run1 + (run2 ?? "");
  // Require a genuine connector: an arrowhead, or a 2+ char dash/dot run. This
  // rejects a stray "." or "-" that is part of a token rather than an edge. When a
  // direction/colour modifier was consumed, an arrowhead is REQUIRED — otherwise
  // ordinary prose ("top-left-corner") would read as an undirected edge.
  if (head !== "<" && tail !== ">" && (run2 !== undefined || body.length < 2)) return false;

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
  // Strict mode may leave an endpoint unresolved (recorded above). Drop the edge
  // rather than connect to a phantom — the line was still recognized as an edge.
  if (leftId == null || rightId == null) return true;
  const [source, target] = reversed ? [rightId, leftId] : [leftId, rightId];

  state.diagram.edges.push({ source, target, style, undirected, label: label ? cleanLabel(label) : undefined });
  return true;
}

export function parsePuml(source: string, opts?: { strict?: boolean }): PumlDiagram {
  const diagram: PumlDiagram = {
    direction: "DOWN",
    roots: [],
    edges: [],
    index: new Map(),
    unresolvedEndpoints: [],
  };
  const state: ParseState = {
    diagram,
    stack: [],
    aliases: new Map(),
    unresolvedSeen: new Set(),
    counter: { n: 0 },
    strict: opts?.strict ?? false,
  };

  // Normalize escaped newlines up front so labels survive masking.
  const lines = source.replace(/\r\n/g, "\n").replace(/\\n/g, NL).split("\n");

  let skinDepth = 0; // brace depth while skipping a skinparam {...} block

  // Lookahead memos for the two scans an unterminated `note` performs (see below).
  // Both used to walk to EOF for EVERY such note, so N unterminated notes cost
  // O(N²) line tests — 32k `note` lines burned ~18s of synchronous work, and this
  // parse runs in PlantUml's render-phase useMemo, so that is a frozen tab and the
  // isDiagramTooLarge guard (which only runs on the finished diagram) never gets a
  // chance to degrade the render. `i` only moves forward, so remembering where the
  // previous scan ended makes the whole pass linear.
  let noEndNoteFrom = Number.POSITIVE_INFINITY; // no `end note` exists at/after here
  let breakFrom = -1; // the last section scan proved [breakFrom, breakAt) has no break
  let breakAt = -1; // first blank / `}` / @enduml at/after breakFrom (lines.length = none)

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
    // `note <pos>` with no `of <id>` is a POSITION-only note, and PlantUML's most
    // common form — every `note right` in the committed diagrams writes it. With the
    // `of` clause optional as a WHOLE, the direction word fell straight through to
    // the id capture, so `note right` asked to anchor to a node called "right". It
    // missed (nothing is aliased that), so the note merely floated — but a diagram
    // that aliases a node `left`/`right`/`top`/`bottom` would have gained a dashed
    // edge to it, and the position word was silently discarded either way. The
    // direction branch now owns its own optional `of <id>`; the bare-id form
    // (`note foo`) keeps its own alternative, and a word boundary keeps "rightish" an id.
    const noteMatch =
      /^note\s+(?:(top|bottom|left|right)\b(?:\s+of\s+([A-Za-z_][\w]*))?|([A-Za-z_][\w]*))?\s*(?::\s*(.*))?$/i.exec(
        trimmed
      );
    if (/^note\b/i.test(trimmed) && noteMatch) {
      let text = noteMatch[4] ?? "";
      if (!noteMatch[4]) {
        // Multi-line note: the body runs until `end note`. Guard that scan —
        // without a terminator the original loop ran to EOF and silently
        // absorbed every following node, edge and container into the note,
        // rendering the diagram truncated with no error. Look ahead for the
        // terminator first; only consume the body to it if it actually exists.
        let term = i + 1;
        if (term >= noEndNoteFrom) {
          term = lines.length; // an earlier scan already proved there is none left
        } else {
          while (term < lines.length && !/^end\s*note\s*$/i.test(lines[term].trim())) {
            term += 1;
          }
          if (term >= lines.length) noEndNoteFrom = i + 1;
        }
        if (term < lines.length) {
          // Terminator found — body is everything up to `end note` (skipped next).
          text = lines.slice(i + 1, term).map((l) => l.trim()).join("\n");
          i = term;
        } else {
          // No terminator. A blank line is the author's section break, so if one
          // appears before the enclosing block closes (`}` / @enduml) treat it as
          // the note's end and keep parsing after it. If structural content runs
          // straight into the block boundary with no blank line, we can't tell
          // where the note stops — fall back to single-line handling (empty body,
          // consume nothing) so the following nodes, edges and the closing brace
          // still parse, rather than being swallowed into the note.
          let stop: number;
          if (i + 1 >= breakFrom && i + 1 <= breakAt) {
            stop = breakAt; // inside a stretch a previous scan already proved break-free
          } else {
            stop = i + 1;
            while (stop < lines.length && lines[stop].trim() !== "") {
              const t = lines[stop].trim();
              if (t === "}" || /^@enduml\b/i.test(t)) break;
              stop += 1;
            }
            breakFrom = i + 1;
            breakAt = stop;
          }
          if (stop < lines.length && lines[stop].trim() === "") {
            text = lines.slice(i + 1, stop).map((l) => l.trim()).join("\n");
            i = stop - 1; // re-examine the blank line next (harmlessly skipped)
          }
          // else: single-line fallback — leave `i` and the empty `text` untouched.
        }
      }
      // The id after `of`, or the bare-id form. A direction word is a POSITION and
      // never an anchor.
      const anchor = noteMatch[2] ?? noteMatch[3];
      const id = genId(state);
      const node: PumlNode = { type: "node", id, label: cleanLabel(text), kind: "note" };
      // Attach where the note was WRITTEN, like every other element. This pushed to
      // `diagram.roots` unconditionally, so a note inside a `package { ... }` became a
      // sibling of that package and ELK laid it out beside the box instead of within
      // it -- the annotation drifted away from the group it annotates. Live on three
      // committed diagrams (05-job-ingestion-pipeline, 09-student-transformation x2,
      // 12-career-switcher). A top-level note is unaffected: currentChildren() returns
      // diagram.roots when the container stack is empty.
      currentChildren(state).push(node);
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
