import "./scene.css";

/** A lit item where it is drawn: its centre and its own radius, in the figure's pixels. */
export type HaloPoint = { id: string; x: number; y: number; r: number };

/**
 * @catalog Breathing halos over the items a reader is pointing at (a queue, a count, one person): a state, never ambient; coral when they wait on a person, the calm ink when they are merely in motion; still under reduced motion.
 *
 * An SVG laid over a figure of `width` x `height` (a canvas or an SVG drawing), decorative
 * (`aria-hidden`): the words that name the lit set live on whatever is pointed at. The halos
 * breathe out of phase (a stagger of 9), so a crowd shimmers instead of pulsing as one.
 */
export function Halos({ points, width, height, calm = false }: { points: readonly HaloPoint[]; width: number; height: number; calm?: boolean }) {
  return (
    <svg className={calm ? "k-halos is-calm" : "k-halos"} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {points.map((d, i) => (
        <circle key={d.id} cx={d.x} cy={d.y} r={d.r * 1.5 + 3.5} style={{ animationDelay: `${(i % 9) * -290}ms` }} />
      ))}
    </svg>
  );
}
