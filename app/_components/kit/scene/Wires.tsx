import { noteArrow, threadPath, wirePath, type Pt, type Wire } from "./wireGeometry";
import "./scene.css";

/** One card's wire (from `wireFor`), and whether it waits on a person (`calm` = merely in motion). */
export type SceneWire = { key: string; w: Wire; calm?: boolean };

/**
 * @catalog The wire layer of a scene: one SVG over the whole scene joining each card to the ring its items stand on (dashed at rest; the pointed card's wire lit coral, or the ink when calm), threads from that wire's end to each lit item, and a hand note's arrow.
 *
 * The caller measures (every point in the scene's own box, `wireFor` / `nearest` in wireGeometry.ts) and
 * places the layer absolutely over the scene; this only draws. Decorative (`aria-hidden`), with no
 * pointer events: the cards and the figure carry the names. A layout with no room for wires (a
 * stacked scene) hides the layer, it does not squeeze it.
 */
export function Wires({ wires, hot, threads, arrow, className }: {
  wires: readonly SceneWire[];
  /** The key of the wire being pointed at, or null. */
  hot: string | null;
  /** The lit wire's threads: its hub, and each lit item's point (drawn only with a hot wire). */
  threads?: { center: Pt; to: readonly { key: string; pt: Pt }[] } | null;
  /** A hand note's arrow: from where its words end to what it points at. */
  arrow?: { from: Pt; to: Pt } | null;
  className?: string;
}) {
  const lit = hot ? wires.find((x) => x.key === hot) ?? null : null;
  const head = arrow ? noteArrow(arrow.from, arrow.to) : null;
  return (
    <svg className={className ? `k-wires ${className}` : "k-wires"} aria-hidden>
      {wires.map(({ key, calm, w }) => (
        <g key={key} className={["k-wire", calm ? "is-calm" : "", hot === key ? "is-on" : ""].filter(Boolean).join(" ")}>
          <path d={wirePath(w)} />
          <circle cx={w.x2} cy={w.y2} r={4} />
        </g>
      ))}
      {lit && threads ? (
        <g className={lit.calm ? "k-threads is-calm" : "k-threads"}>
          {threads.to.map((t) => (
            <path key={t.key} d={threadPath({ x: lit.w.x2, y: lit.w.y2 }, t.pt, threads.center)} />
          ))}
        </g>
      ) : null}
      {head ? (
        <g className="k-note-arrow">
          <path d={head.shaft} />
          <path d={head.head} />
        </g>
      ) : null}
    </svg>
  );
}
