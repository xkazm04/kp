import type { MarkKind } from "./types";
import { markClass, markShapes, type MarkShape } from "./marks";
import "./kit.css";

function Shape({ s }: { s: MarkShape }) {
  const paint = s.fill ? { fill: "currentColor" } : { fill: "none", stroke: "currentColor", strokeWidth: s.sw };
  if (s.el === "circle") return <circle cx={s.cx} cy={s.cy} r={s.r} strokeDasharray={s.dash} {...paint} />;
  if (s.el === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...paint} />;
  return <path d={s.d} strokeLinecap="round" strokeLinejoin={s.join ? "round" : undefined} {...paint} />;
}

/**
 * @catalog A 16px status mark whose SHAPE carries the meaning (ok, wait, needs, fail, bounce, recovered, unknown, caution, human, machine, nobody); its words live in the tip.
 */
export function Mark({ kind, tip, hollow = false }: { kind: MarkKind; tip?: string; hollow?: boolean }) {
  return (
    <span className={markClass(kind)} data-tip={tip} role="img" aria-label={tip ?? kind} tabIndex={tip ? -1 : undefined}>
      <svg viewBox="0 0 16 16" aria-hidden>
        {markShapes(kind, hollow).map((s, i) => <Shape key={i} s={s} />)}
      </svg>
    </span>
  );
}
