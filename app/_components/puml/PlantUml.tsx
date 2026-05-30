"use client";

import { useEffect, useMemo, useState } from "react";
import { parsePuml } from "./parse";
import { layoutDiagram, type Box, type PositionedDiagram, type PositionedEdge } from "./layout";

// SVG renderer for our PlantUML component-diagram subset. Layout coordinates
// come from ELK; every shape, colour, and stroke here is ours, drawn from the
// app design tokens so diagrams read as part of the product, not a screenshot.

const LINE_H = 18;
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Design tokens (mirrors globals.css @theme).
const C = {
  ink: "#17202a",
  paper: "#f7f5ef",
  moss: "#526b4f",
  coral: "#d65a4a",
  steel: "#42606f",
  stone: "#d6d3d1",
  stoneSoft: "#e7e5e4",
  dialStone: "#8c8779",
  dialAmber: "#caa54c",
  white: "#ffffff",
};

// A hand-tuned cloud silhouette in its own coordinate box (≈ x:13–94, y:22–71);
// renderShape maps that bbox onto the node's box with a transform.
const CLOUD_PATH =
  "M83.5,46.7c0-0.2,0-0.4,0-0.6c0-9.2-7.4-16.6-16.6-16.6c-3.6,0-7,1.2-9.7,3.1C54.4,26.3,48.5,22,41.6,22" +
  "c-9.9,0-17.9,8-17.9,17.9c0,0.6,0,1.2,0.1,1.8C17.8,43.4,13,49.3,13,56.3C13,64.4,19.6,71,27.7,71h53.1" +
  "c7.3,0,13.2-5.9,13.2-13.2C94,52.1,89.4,47.3,83.5,46.7z";
const CLOUD_BBOX = { x: 13, y: 22, w: 81, h: 49 };

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
    <text fontFamily={FONT} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>
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
  if (/gate|human|review|approval|manual/.test(s)) return { fill: "#fbece8", stroke: C.coral, text: C.ink };
  if (/todo|planned|gap|missing|future|build/.test(s)) return { fill: "#f4f2ec", stroke: C.dialStone, text: "#6b6557", dash: true };
  return { fill: "#e9f1e2", stroke: "#5d7a57", text: C.ink }; // auto / v2 / new / focus
}

function renderNode(box: Box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

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
        <g key={box.id}>
          <Cylinder box={box} fill="#eef2f3" lid="#e2e9ea" stroke={C.steel} />
          <Label lines={box.lines} cx={cx} cy={cy + 4} fill={C.ink} />
        </g>
      );
    case "cloud": {
      const sx = box.w / CLOUD_BBOX.w;
      const sy = box.h / CLOUD_BBOX.h;
      return (
        <g key={box.id}>
          <path
            transform={`translate(${box.x},${box.y}) scale(${sx},${sy}) translate(${-CLOUD_BBOX.x},${-CLOUD_BBOX.y})`}
            d={CLOUD_PATH}
            fill="#f3f1ea"
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
        <g key={box.id}>
          <Folder box={box} fill={C.paper} stroke={C.stone} />
          <Label lines={box.lines} cx={cx} cy={cy + 4} fill={C.ink} />
        </g>
      );
    case "note":
      return (
        <g key={box.id}>
          <Note box={box} fill="#fbf4e0" fold="#efe2ba" stroke={C.dialAmber} />
          <Label lines={box.lines} cx={cx} cy={cy} fill="#5b4f2e" size={14} weight={500} />
        </g>
      );
    default: {
      const st = componentStyle(box.stereotype);
      return (
        <g key={box.id}>
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
  const stroke = tagged ? "#9cb394" : "#dcd8cf";
  const fill = tagged ? "rgba(233,241,226,0.45)" : "rgba(247,245,239,0.55)";
  const titleColor = tagged ? C.moss : C.coral;
  return (
    <g key={box.id}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12} fill={fill} stroke={stroke} strokeWidth={1.25} />
      <text
        x={box.x + 15}
        y={box.y + 25}
        fontFamily={FONT}
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

function renderEdge(edge: PositionedEdge) {
  if (edge.points.length < 2) return null;
  const color = edge.style === "dashed" ? C.dialStone : C.steel;
  const marker = edge.style === "dashed" ? "url(#puml-arrow-dashed)" : "url(#puml-arrow-solid)";
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
}: {
  source: string;
  className?: string;
  // "fit" scales the diagram to the container (default). "natural" renders at
  // true size and scrolls horizontally when wider — so a dense diagram's text
  // is never shrunk below its 14px floor.
  scale?: "fit" | "natural";
}) {
  const diagram = useMemo(() => {
    try {
      return parsePuml(source);
    } catch {
      return null;
    }
  }, [source]);

  // A parse failure or empty diagram is derivable during render — only the
  // async ELK layout needs an effect. The result is keyed to `diagram` so a
  // stale layout never shows after `source` changes (no setState in the effect
  // body, which avoids cascading renders).
  const isEmpty = !diagram || (diagram.roots.length === 0 && diagram.edges.length === 0);
  const [result, setResult] = useState<{
    key: unknown;
    layout: PositionedDiagram | null;
    failed: boolean;
  }>({ key: null, layout: null, failed: false });

  useEffect(() => {
    if (isEmpty || !diagram) return;
    let cancelled = false;
    layoutDiagram(diagram)
      .then((res) => {
        if (!cancelled) setResult({ key: diagram, layout: res, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: diagram, layout: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [diagram, isEmpty]);

  const ready = result.key === diagram;
  const layout = ready ? result.layout : null;
  const failed = isEmpty || (ready && result.failed);

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

  const pad = 8;
  const W = layout.width + pad * 2;
  const H = layout.height + pad * 2;
  const natural = scale === "natural";

  return (
    <figure className={`my-4 overflow-hidden rounded-lg border border-stone-200 bg-white ${className}`}>
      <div className={natural ? "overflow-x-auto" : ""}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={layout.title ? `Diagram: ${layout.title}` : "Component diagram"}
          className="mx-auto block h-auto"
          width={natural ? W : undefined}
          style={natural ? undefined : { width: "100%", maxWidth: W }}
        >
          <defs>
          <marker id="puml-arrow-solid" markerWidth={9} markerHeight={9} refX={7} refY={3} orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L7,3 L0,6 Z" fill={C.steel} />
          </marker>
          <marker id="puml-arrow-dashed" markerWidth={9} markerHeight={9} refX={7} refY={3} orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L7,3 L0,6 Z" fill={C.dialStone} />
          </marker>
        </defs>
          <g transform={`translate(${pad},${pad})`}>
            {layout.containers.map(renderContainer)}
            {layout.edges.map(renderEdge)}
            {layout.nodes.map(renderNode)}
          </g>
        </svg>
      </div>
      {layout.title ? (
        <figcaption className="border-t border-stone-200 bg-paper px-4 py-2 text-meta uppercase text-steel">
          {layout.title}
        </figcaption>
      ) : null}
    </figure>
  );
}
