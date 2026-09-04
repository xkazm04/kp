"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { isPumlSourceTooLarge, parsePuml, type PumlDiagram } from "./parse";
import { isDiagramTooLarge, layoutDiagram, type Box, type PositionedDiagram, type PositionedEdge } from "./layout";
import { DIAGRAM_PAD, DIAGRAM_STATUS_TOKENS, FONT_FAMILY, LINE_H } from "./constants";
import { clickableNodeAria, diagramSvgRole } from "./a11y";

// SVG renderer for our PlantUML component-diagram subset. Layout coordinates
// come from ELK; every shape, colour, and stroke here is ours, drawn from the
// app design tokens so diagrams read as part of the product, not a screenshot.
// LINE_H / FONT_FAMILY / DIAGRAM_PAD are shared with measure + layout (see
// ./constants) so text sizing and positioning never drift.

// The single home for every diagram colour.
//
// The token half resolves through CSS variables, not the app/_lib/brand.ts JS mirror.
// It USED to import that mirror -- which put the literals under `design:check`'s
// lockstep rule and so looked correct -- but MOSS/CORAL/INK/PAPER/... are LIGHT-ONLY
// constants there (brand.ts exports a DARK object for exactly this reason, and this
// file never forked on it). An in-DOM SVG reads var() straight from a fill/stroke
// attribute, so the diagram can just use the tokens and flip with the theme for free.
// The mirror is for surfaces the token system genuinely cannot reach: the
// edge-runtime OG image and the icons, which render with no stylesheet.
//
// `stone`/`stoneSoft` were stock Tailwind hexes (#d6d3d1 / #e7e5e4), so they missed
// BOTH halves of this repo's warm neutral ramp as well as the dark remap.
//
// The shape-fill block below holds the bespoke primitive tints that are diagram-only
// (no token counterpart) -- they used to live as ~ten orphaned hex literals scattered
// through the shape renderers (idea-a1c39c26), so retuning a shape meant hunting for a
// stray hex. One map = one edit to re-tone a diagram.
// (The component status trichotomy in componentStyle lives in ./constants.)
//
// TODO(dark-theme): the shape-fill block is still light-only, and it is now
// EXACTLY three primitives -- the sticky note, the cloud silhouette and the
// database cylinder. Giving those dark tints is a design decision with no token
// to derive from, so it is deliberately NOT guessed here (see the /explorer sweep
// note of 2026-08-29).
//
// The token half above covers every component box, container GROUP box, edge,
// label and status colour. That sentence used to be written here while the four
// container-group colours sat in the block below as light-only literals -- the
// largest painted area on an architecture diagram, claimed as covered. They are
// tokens now, so the claim is true; keep it true when adding a colour.
const C = {
  ink: "var(--color-ink)",
  paper: "var(--color-paper)",
  moss: "var(--color-moss)",
  coral: "var(--color-coral)",
  steel: "var(--color-steel)",
  stone: "var(--color-stone-300)",
  stoneSoft: "var(--color-stone-200)",
  dialStone: "var(--color-dial-stone)",
  dialAmber: "var(--color-dial-amber)",
  white: "var(--color-white)",
  // Container group box, kind-agnostic: tagged (has a stereotype) vs plain.
  // These were four LIGHT literals (#9cb394 / #dcd8cf + two rgba fills) sitting
  // in the block below while the comment above claimed the tokens covered every
  // container — so Spark Dark framed each phase of every architecture diagram in
  // near-white on a #141b24 canvas. The tokens are brand-derived (globals.css),
  // so they now flip with the theme like every other diagram colour.
  groupTaggedStroke: "var(--color-diagram-group-tagged-stroke)",
  groupPlainStroke: "var(--color-diagram-group-plain-stroke)",
  groupTaggedFill: "var(--color-diagram-group-tagged-fill)",
  groupPlainFill: "var(--color-diagram-group-plain-fill)",

  // Database cylinder (body + lid).
  dbFill: "#eef2f3",
  dbLid: "#e2e9ea",
  // Cloud silhouette fill.
  cloudFill: "#f3f1ea",
  // Sticky note (face + folded corner + ink).
  noteFill: "#fbf4e0",
  noteFold: "#efe2ba",
  noteText: "#5b4f2e",
};

// A hand-tuned cloud silhouette in its own coordinate box (≈ x:13–94, y:22–71);
// renderShape maps that bbox onto the node's box with a transform.
const CLOUD_PATH =
  "M83.5,46.7c0-0.2,0-0.4,0-0.6c0-9.2-7.4-16.6-16.6-16.6c-3.6,0-7,1.2-9.7,3.1C54.4,26.3,48.5,22,41.6,22" +
  "c-9.9,0-17.9,8-17.9,17.9c0,0.6,0,1.2,0.1,1.8C17.8,43.4,13,49.3,13,56.3C13,64.4,19.6,71,27.7,71h53.1" +
  "c7.3,0,13.2-5.9,13.2-13.2C94,52.1,89.4,47.3,83.5,46.7z";
const CLOUD_BBOX = { x: 13, y: 22, w: 81, h: 49 };

/** A short, log-safe name for a diagram, read from the source's own `@startuml <name>`
 *  or `title` line. Used to say WHICH diagram failed when the parse never produced
 *  a model to ask. Only the first 2 KB is scanned — the header is at the top or the
 *  source is not one we authored. */
function sourceId(source: string): string {
  const head = source.slice(0, 2000);
  const named = head.match(/^\s*@startuml[ \t]+(\S.*)$/im)?.[1] ?? head.match(/^\s*title[ \t]+(\S.*)$/im)?.[1];
  return named?.trim().slice(0, 80) ?? "untitled";
}

function Label({
  lines,
  cx,
  cy,
  fill,
  size = 14,
  weight = 500,
  anchor = "middle",
}: {
  lines: string[];
  cx: number;
  cy: number;
  fill: string;
  size?: number;
  weight?: number;
  anchor?: "middle" | "start";
}) {
  const total = lines.length * LINE_H;
  return (
    <text fontFamily={FONT_FAMILY} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>
      {lines.map((line, i) => (
        <tspan key={i} x={cx} y={cy - total / 2 + i * LINE_H + LINE_H * 0.74}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function Cylinder({ box, fill, lid, stroke }: { box: Box; fill: string; lid: string; stroke: string }) {
  const { x, y, w, h } = box;
  const rx = w / 2;
  const ry = 8;
  return (
    <g>
      <ellipse cx={x + rx} cy={y + h - ry} rx={rx} ry={ry} fill={fill} stroke={stroke} strokeWidth={1.25} />
      <rect x={x} y={y + ry} width={w} height={h - 2 * ry} fill={fill} />
      <line x1={x} y1={y + ry} x2={x} y2={y + h - ry} stroke={stroke} strokeWidth={1.25} />
      <line x1={x + w} y1={y + ry} x2={x + w} y2={y + h - ry} stroke={stroke} strokeWidth={1.25} />
      <ellipse cx={x + rx} cy={y + ry} rx={rx} ry={ry} fill={lid} stroke={stroke} strokeWidth={1.25} />
    </g>
  );
}

function Actor({ box, stroke }: { box: Box; stroke: string }) {
  const cx = box.x + box.w / 2;
  const top = box.y + 4;
  return (
    <g stroke={stroke} strokeWidth={1.6} fill="none" strokeLinecap="round">
      <circle cx={cx} cy={top + 5} r={4.5} fill={C.white} />
      <line x1={cx} y1={top + 10} x2={cx} y2={top + 21} />
      <line x1={cx - 7} y1={top + 14} x2={cx + 7} y2={top + 14} />
      <line x1={cx} y1={top + 21} x2={cx - 6} y2={top + 29} />
      <line x1={cx} y1={top + 21} x2={cx + 6} y2={top + 29} />
    </g>
  );
}

function Folder({ box, fill, stroke }: { box: Box; fill: string; stroke: string }) {
  const { x, y, w, h } = box;
  const tab = 9;
  return (
    <g>
      <rect x={x} y={y} width={w * 0.46} height={tab + 5} rx={3} fill={fill} stroke={stroke} strokeWidth={1.25} />
      <rect x={x} y={y + tab} width={w} height={h - tab} rx={7} fill={fill} stroke={stroke} strokeWidth={1.25} />
    </g>
  );
}

function Note({ box, fill, fold, stroke }: { box: Box; fill: string; fold: string; stroke: string }) {
  const { x, y, w, h } = box;
  const f = 11;
  return (
    <g>
      <path
        d={`M ${x} ${y} H ${x + w - f} L ${x + w} ${y + f} V ${y + h} H ${x} Z`}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path d={`M ${x + w - f} ${y} V ${y + f} H ${x + w} Z`} fill={fold} stroke={stroke} strokeWidth={1.1} />
    </g>
  );
}

// Map a component's <<stereotype>> to a style. Lets a single diagram speak in
// our vocabulary: moss = automated/new, coral = deliberate human gate, dashed
// stone = not-yet-built. Unknown stereotypes fall back to the moss "tagged" look.
function componentStyle(stereotype?: string): { fill: string; stroke: string; text: string; dash?: boolean } {
  const s = (stereotype ?? "").toLowerCase();
  if (!s) return { fill: C.white, stroke: C.stone, text: C.ink };
  if (/gate|human|review|approval|manual/.test(s))
    return { fill: DIAGRAM_STATUS_TOKENS.gate.fill, stroke: DIAGRAM_STATUS_TOKENS.gate.stroke, text: C.ink };
  if (/todo|planned|gap|missing|future|build/.test(s))
    return { fill: DIAGRAM_STATUS_TOKENS.gap.fill, stroke: DIAGRAM_STATUS_TOKENS.gap.stroke, text: "var(--color-diagram-gap-text)", dash: true };
  // auto / v2 / new / focus
  return { fill: DIAGRAM_STATUS_TOKENS.live.fill, stroke: DIAGRAM_STATUS_TOKENS.live.stroke, text: C.ink };
}

type NodeClick = (node: { id: string; label: string }) => void;

function renderNode(box: Box, onNodeClick?: NodeClick, activeNodeId?: string) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Actors/notes aren't pipeline steps, so only the real nodes are clickable.
  const clickable = Boolean(onNodeClick) && box.kind !== "actor" && box.kind !== "note";
  const active = activeNodeId != null && box.id === activeNodeId;
  const className = [clickable ? "puml-clickable" : "", active ? "puml-active" : ""].filter(Boolean).join(" ");
  const clickProps: {
    className?: string;
    role?: string;
    tabIndex?: number;
    "aria-label"?: string;
    "aria-pressed"?: boolean;
    onClick?: () => void;
    onKeyDown?: (e: { key: string; preventDefault: () => void }) => void;
  } = {
    ...(className ? { className } : {}),
    ...(clickable
      ? {
          role: "button",
          tabIndex: 0,
          // bug-ui-scan-2026-07-09 (architecture-diagrams #4): name each clickable
          // node and expose its open/active state so SR users get a labeled button
          // with a programmatic equivalent of the coral "active" border.
          ...clickableNodeAria(box.label, active),
          onClick: () => onNodeClick!({ id: box.id, label: box.label }),
          onKeyDown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNodeClick!({ id: box.id, label: box.label });
            }
          },
        }
      : {}),
  };

  switch (box.kind) {
    case "actor":
      return (
        <g key={box.id}>
          <Actor box={box} stroke={C.steel} />
          <Label lines={box.lines} cx={cx} cy={box.y + 30 + (box.lines.length * LINE_H) / 2} fill={C.ink} weight={600} />
        </g>
      );
    case "database":
      return (
        <g key={box.id} {...clickProps}>
          <Cylinder box={box} fill={C.dbFill} lid={C.dbLid} stroke={C.steel} />
          <Label lines={box.lines} cx={cx} cy={cy + 4} fill={C.ink} />
        </g>
      );
    case "cloud": {
      const sx = box.w / CLOUD_BBOX.w;
      const sy = box.h / CLOUD_BBOX.h;
      return (
        <g key={box.id} {...clickProps}>
          <path
            transform={`translate(${box.x},${box.y}) scale(${sx},${sy}) translate(${-CLOUD_BBOX.x},${-CLOUD_BBOX.y})`}
            d={CLOUD_PATH}
            fill={C.cloudFill}
            stroke={C.dialStone}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
          <Label lines={box.lines} cx={cx} cy={cy + 2} fill={C.ink} />
        </g>
      );
    }
    case "folder":
      return (
        <g key={box.id} {...clickProps}>
          <Folder box={box} fill={C.paper} stroke={C.stone} />
          <Label lines={box.lines} cx={cx} cy={cy + 4} fill={C.ink} />
        </g>
      );
    case "note":
      return (
        <g key={box.id}>
          <Note box={box} fill={C.noteFill} fold={C.noteFold} stroke={C.dialAmber} />
          <Label lines={box.lines} cx={cx} cy={cy} fill={C.noteText} size={14} weight={500} />
        </g>
      );
    default: {
      const st = componentStyle(box.stereotype);
      return (
        <g key={box.id} {...clickProps}>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={9}
            fill={st.fill}
            stroke={st.stroke}
            strokeWidth={1.3}
            strokeDasharray={st.dash ? "5 4" : undefined}
          />
          <Label lines={box.lines} cx={cx} cy={cy} fill={st.text} />
        </g>
      );
    }
  }
}

function renderContainer(box: Box) {
  const tagged = !!box.stereotype;
  const stroke = tagged ? C.groupTaggedStroke : C.groupPlainStroke;
  const fill = tagged ? C.groupTaggedFill : C.groupPlainFill;
  const titleColor = tagged ? C.moss : C.coral;
  return (
    <g key={box.id}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12} fill={fill} stroke={stroke} strokeWidth={1.25} />
      <text
        x={box.x + 15}
        y={box.y + 25}
        fontFamily={FONT_FAMILY}
        fontSize={14}
        fontWeight={600}
        letterSpacing="0.06em"
        fill={titleColor}
        style={{ textTransform: "uppercase" }}
      >
        {box.label.toUpperCase()}
      </text>
    </g>
  );
}

function edgePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function renderEdge(edge: PositionedEdge, markerSolid: string, markerDashed: string) {
  if (edge.points.length < 2) return null;
  const color = edge.style === "dashed" ? C.dialStone : C.steel;
  const marker = edge.style === "dashed" ? `url(#${markerDashed})` : `url(#${markerSolid})`;
  return (
    <g key={edge.id}>
      <path
        d={edgePath(edge.points)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeDasharray={edge.style === "dashed" ? "4 4" : undefined}
        markerEnd={edge.undirected ? undefined : marker}
      />
      {edge.label && edge.labelBox ? (
        <g>
          <rect
            x={edge.labelBox.x - 4}
            y={edge.labelBox.y - 1}
            width={edge.labelBox.w + 8}
            height={edge.labelBox.h + 2}
            rx={4}
            fill={C.paper}
            stroke={C.stoneSoft}
            strokeWidth={1}
          />
          <Label
            lines={[edge.label]}
            cx={edge.labelBox.x + edge.labelBox.w / 2}
            cy={edge.labelBox.y + edge.labelBox.h / 2}
            fill={C.steel}
            size={14}
            weight={600}
          />
        </g>
      ) : null}
    </g>
  );
}

export function PlantUml({
  source,
  className = "",
  scale = "fit",
  onNodeClick,
  activeNodeId,
  expandable = false,
  strict = false,
}: {
  source: string;
  className?: string;
  // "fit" scales the diagram to the container (default). "natural" renders at
  // true size and scrolls horizontally when wider — so a dense diagram's text
  // is never shrunk below its 14px floor.
  scale?: "fit" | "natural";
  // When set, non-actor/note nodes become clickable (cursor, hover, keyboard).
  onNodeClick?: NodeClick;
  // The node id to mark as active (persistent coral border).
  activeNodeId?: string;
  // When true, overlays a button that opens the diagram in a full-screen modal —
  // worth it for the dense architecture diagrams whose text shrinks in a column.
  expandable?: boolean;
  // Declared-only diagrams (e.g. the interactive funnel) opt into strict parsing:
  // a mistyped edge endpoint is dropped + warned in dev rather than fabricating a
  // phantom node that becomes a dead click target (idea-bf583bb5). Leave false for
  // class diagrams that legitimately render from edge endpoints alone.
  strict?: boolean;
}) {
  const tDiagram = useTranslations("diagrams.controls");
  const [expanded, setExpanded] = useState(false);
  // Which diagram failed. On a PARSE failure there is no parsed title to name it
  // by, and "[PlantUml] parse failed" on a page rendering four diagrams names
  // none of them — so scrape the id the source itself carries (`@startuml <name>`
  // or the `title` line) before parsing. Never the source body: a log line is not
  // a place to dump a paste.
  const diagramId = useMemo(() => sourceId(source), [source]);
  // A parse either succeeds, refuses on size (a CODED refusal — same friendly
  // "too large" copy the post-parse guard renders), or throws. The last case used
  // to be `catch { return null }`: the failure was swallowed with no diagnostic
  // anywhere and the user got a wall of raw PlantUML source, while the SIBLING
  // layout failure right below logged and rendered a message. Same class of
  // failure, two behaviours — now one.
  const parsed = useMemo((): { diagram: PumlDiagram | null; refusal: "tooLarge" | "failed" | null } => {
    try {
      return { diagram: parsePuml(source, { strict }), refusal: null };
    } catch (err) {
      if (isPumlSourceTooLarge(err)) return { diagram: null, refusal: "tooLarge" };
      console.error(`[PlantUml] diagram "${diagramId}" parse failed:`, err instanceof Error ? err.message : err);
      return { diagram: null, refusal: "failed" };
    }
  }, [source, strict, diagramId]);
  const diagram = parsed.diagram;

  // Surface mistyped aliases in declared-only diagrams: a strict parse records
  // any endpoint that resolved to no declared node, so a typo no longer ships a
  // silently-wrong architecture picture with zero signal.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !strict || !diagram) return;
    if (diagram.unresolvedEndpoints.length === 0) return;
    console.warn(
      `[puml] ${diagram.title ? `diagram "${diagram.title}" ` : ""}has ` +
        `${diagram.unresolvedEndpoints.length} unresolved edge endpoint(s) — likely a mistyped alias: ` +
        `${diagram.unresolvedEndpoints.join(", ")}. The edge was dropped rather than fabricating a phantom node.`
    );
  }, [diagram, strict]);

  // A parse failure or empty diagram is derivable during render — only the
  // async ELK layout needs an effect. The result is keyed to `diagram` so a
  // stale layout never shows after `source` changes (no setState in the effect
  // body, which avoids cascading renders).
  const isEmpty = !diagram || (diagram.roots.length === 0 && diagram.edges.length === 0);
  // Derived (pure), like isEmpty: an oversized/adversarial source would freeze the tab
  // if handed to ELK, so we detect it during render and skip layout entirely.
  // Two ceilings, ONE user-visible outcome: the parser refuses an oversized SOURCE
  // (before doing its linear pass) and this refuses an oversized parsed DIAGRAM
  // (before handing ELK a graph that would freeze the tab). Both render tooLarge.
  const tooLarge = parsed.refusal === "tooLarge" || (!!diagram && isDiagramTooLarge(diagram));
  const [result, setResult] = useState<{
    key: unknown;
    layout: PositionedDiagram | null;
    failed: boolean;
  }>({ key: null, layout: null, failed: false });

  useEffect(() => {
    if (isEmpty || tooLarge || !diagram) return; // tooLarge: never call ELK (would freeze)
    let cancelled = false;
    layoutDiagram(diagram)
      .then((res) => {
        if (!cancelled) setResult({ key: diagram, layout: res, failed: false });
      })
      .catch((err) => {
        if (!cancelled) {
          // Log the real layout error — the failure was previously swallowed and the user
          // shown raw PlantUML source with no diagnostic anywhere.
          console.error(`[PlantUml] diagram "${diagramId}" layout failed:`, err instanceof Error ? err.message : err);
          setResult({ key: diagram, layout: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diagram, isEmpty, tooLarge, diagramId]);

  const ready = result.key === diagram;
  const layout = ready ? result.layout : null;
  const failed = isEmpty || (ready && result.failed);

  // Oversized/adversarial diagram: layout was skipped (it would freeze the tab), so
  // degrade gracefully with a message instead of an endless skeleton.
  if (tooLarge) {
    return (
      <div role="alert" className={`rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel ${className}`}>
        {tDiagram("tooLarge")}
      </div>
    );
  }

  // A real parse OR layout failure shows a friendly message (not a wall of raw
  // PlantUML source, which read as a broken render to the user). They are the same
  // class of failure and now share one branch. An empty-but-PARSEABLE diagram still
  // keeps the source as a reasonable text fallback.
  if (parsed.refusal === "failed" || (ready && result.failed)) {
    return (
      <div role="alert" className={`rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel ${className}`}>
        {tDiagram("renderFailed")}
      </div>
    );
  }
  if (failed) {
    return (
      <pre className={`overflow-x-auto rounded-lg border border-stone-200 bg-paper p-4 text-[12px] leading-5 text-steel ${className}`}>
        <code>{source.trim()}</code>
      </pre>
    );
  }

  if (!layout) {
    return (
      <div
        aria-hidden
        className={`animate-pulse rounded-lg border border-stone-200 bg-paper ${className}`}
        style={{ minHeight: 180 }}
      />
    );
  }

  const natural = scale === "natural";

  return (
    <>
      <figure className={`relative my-4 overflow-hidden rounded-lg border border-stone-200 bg-white ${className}`}>
        {expandable ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={tDiagram("expandToFullScreen")}
            title={tDiagram("expand")}
            className="focus-ring absolute right-2 top-2 z-10 rounded-md border border-stone-200 bg-white/90 p-1.5 text-steel shadow-sm backdrop-blur transition-colors hover:bg-stone-100 hover:text-ink"
          >
            <Maximize2 size={15} />
          </button>
        ) : null}
        <div className={natural ? "overflow-x-auto" : ""}>
          <DiagramSvg layout={layout} sizing={natural ? "natural" : "fit"} onNodeClick={onNodeClick} activeNodeId={activeNodeId} />
        </div>
        {layout.title ? (
          <figcaption className="border-t border-stone-200 bg-paper px-4 py-2 text-meta uppercase text-steel">
            {layout.title}
          </figcaption>
        ) : null}
      </figure>
      {expanded ? <ExpandedDiagram layout={layout} onClose={() => setExpanded(false)} /> : null}
    </>
  );
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.2;

// The full-screen view: opens at 1:1 (natural size) and lets the user zoom in/out
// for adjustments. The diagram scrolls within the viewport when it's larger than
// the modal; "Fit" scales the whole thing to the available space.
function ExpandedDiagram({ layout, onClose }: { layout: PositionedDiagram; onClose: () => void }) {
  const t = useTranslations("diagrams.controls");
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const pad = DIAGRAM_PAD;
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;
  const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const fit = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    // Leave a small margin so the diagram doesn't kiss the edges.
    setZoom(clamp(Math.min((vp.clientWidth - 48) / W, (vp.clientHeight - 48) / H)));
  };

  const btn = "focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
  const textBtn = "focus-ring rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-steel hover:bg-stone-100 hover:text-ink";

  const controls = (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => setZoom((z) => clamp(z / ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} aria-label={t("zoomOut")} className={btn}>
        <ZoomOut size={16} />
      </button>
      <span className="w-12 text-center text-sm tabular-nums text-steel">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom((z) => clamp(z * ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} aria-label={t("zoomIn")} className={btn}>
        <ZoomIn size={16} />
      </button>
      <span className="mx-1 h-5 w-px bg-stone-200" />
      <button type="button" onClick={() => setZoom(1)} className={textBtn}>
        1:1
      </button>
      <button type="button" onClick={fit} className={textBtn}>
        {t("fit")}
      </button>
    </div>
  );

  return (
    <Modal
      title={layout.title ?? t("modalTitleFallback")}
      subtitle={t("modalSubtitle")}
      size="full"
      onClose={onClose}
      footer={controls}
    >
      <div ref={viewportRef} className="h-full w-full overflow-auto rounded-md border border-stone-200 bg-paper">
        {/* min-w/h-full + margin:auto on the child centers a small diagram but,
            unlike justify/items-center, keeps the start reachable when it
            overflows (so a zoomed-in diagram scrolls to its top-left corner). */}
        <div className="flex min-h-full min-w-full p-6">
          <DiagramSvg layout={layout} sizing="zoom" zoom={zoom} />
        </div>
      </div>
    </Modal>
  );
}

// The SVG canvas, shared by the inline figure and the full-screen modal so the
// expanded view reuses the already-computed ELK layout (no recompute). Marker
// ids are namespaced per instance so the inline + modal copies don't collide.
//   - "fit":      width 100%, capped at natural size (the in-column default).
//   - "natural":  intrinsic width; the parent scrolls horizontally if wider.
//   - "zoom":     rendered at `zoom`× true size for the expand modal (1 = 1:1),
//                 so the parent can scroll/pan when it overflows the viewport.
function DiagramSvg({
  layout,
  sizing,
  zoom = 1,
  onNodeClick,
  activeNodeId,
}: {
  layout: PositionedDiagram;
  sizing: "fit" | "natural" | "zoom";
  zoom?: number;
  onNodeClick?: NodeClick;
  activeNodeId?: string;
}) {
  // The SVG's accessible name is the diagram's only name for AT, so it resolves
  // through the catalog like every other string in this file. It was English in all
  // four locales.
  const t = useTranslations("diagrams.controls");
  const uid = useId().replace(/:/g, "");
  const markerSolid = `puml-arrow-solid-${uid}`;
  const markerDashed = `puml-arrow-dashed-${uid}`;
  const pad = DIAGRAM_PAD;
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;
  const zoomed = sizing === "zoom";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // bug-ui-scan-2026-07-09 (architecture-diagrams #4): an interactive funnel
      // must be a `group`, not `img` — role="img" collapses descendants to one
      // opaque image in many AT, hiding its clickable step buttons.
      role={diagramSvgRole(Boolean(onNodeClick))}
      aria-label={layout.title ? t("svgLabelTitled", { title: layout.title }) : t("svgLabelUntitled")}
      preserveAspectRatio="xMidYMid meet"
      className={zoomed ? "m-auto block shrink-0" : "mx-auto block h-auto"}
      width={sizing === "natural" ? W : zoomed ? Math.round(W * zoom) : undefined}
      height={zoomed ? Math.round(H * zoom) : undefined}
      style={zoomed ? undefined : sizing === "natural" ? undefined : { width: "100%", maxWidth: W }}
    >
      <defs>
        <marker id={markerSolid} markerWidth={9} markerHeight={9} refX={7} refY={3} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.steel} />
        </marker>
        <marker id={markerDashed} markerWidth={9} markerHeight={9} refX={7} refY={3} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.dialStone} />
        </marker>
      </defs>
      {onNodeClick || activeNodeId ? (
        <style>{`.puml-clickable{cursor:pointer;outline:none}.puml-clickable rect,.puml-clickable ellipse,.puml-clickable path{transition:stroke .12s,filter .12s}.puml-clickable:hover rect,.puml-clickable:hover ellipse,.puml-clickable:hover path,.puml-clickable:focus-visible rect,.puml-clickable:focus-visible ellipse,.puml-clickable:focus-visible path{stroke:var(--color-coral);stroke-width:2}.puml-active rect,.puml-active ellipse,.puml-active path{stroke:var(--color-coral) !important;stroke-width:2.5 !important}`}</style>
      ) : null}
      <g transform={`translate(${pad},${pad})`}>
        {layout.containers.map(renderContainer)}
        {layout.edges.map((e) => renderEdge(e, markerSolid, markerDashed))}
        {layout.nodes.map((b) => renderNode(b, onNodeClick, activeNodeId))}
      </g>
    </svg>
  );
}
