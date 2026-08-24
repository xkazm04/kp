import type { ChatBlockLabels, ChatChartBlock } from "./chatBlockTypes";

/*
 * A small two-axis chart inside a chat turn — hand-rolled inline SVG, no chart
 * library.
 *
 * Why not recharts (which this app already ships): recharts needs literal color
 * strings for its chrome, so every chart that uses it forks on `useTheme()`
 * (FactorChart does exactly that). At 240px, inside a bubble, in a dock that can
 * be opened before hydration, that fork costs more than the whole drawing is
 * worth. A presentation attribute is parsed as CSS, so `fill="var(--color-coral)"`
 * resolves per theme with no JS at all — the same mechanism MotionizedGlyph uses.
 *
 * Geometry is fixed at 1:1 (width 240, viewBox 240) on purpose: it keeps SVG
 * <text> at a true 14px, the floor the design law sets for anything rendered.
 * A viewBox that scaled would quietly print 9px axis labels on a narrow dock.
 *
 * Austerity: one entry fade, gated centrally by `animate-fade-in` (globals.css
 * kills it under prefers-reduced-motion). Nothing loops, nothing hovers.
 */

const WIDTH = 240;
const PAD_L = 30; // room for the value ticks
const PAD_R = 6;
const PAD_T = 8;
const PLOT_H = 96;
const PAD_B = 24; // room for the category ticks
const HEIGHT = PAD_T + PLOT_H + PAD_B;
const PLOT_W = WIDTH - PAD_L - PAD_R;
const BASE_Y = PAD_T + PLOT_H;

// Two series, two brand meanings: coral is the subject, moss is what it is being
// compared against. Never a third — the block contract caps series at 2.
const SERIES_COLORS = ["var(--color-coral)", "var(--color-moss)"] as const;
const AXIS = "var(--color-stone-300)";
const TICK_TEXT = "var(--color-steel)";

/** How many category ticks fit at 14px without colliding. Beyond that the ticks
 *  thin out to first / middle / last — a label you cannot read is worse than an
 *  absent one, and the bars still carry the shape. */
function tickIndexes(count: number): number[] {
  if (count <= 4) return Array.from({ length: count }, (_, i) => i);
  const last = count - 1;
  return [...new Set([0, Math.round(last / 2), last])];
}

/** A round number at or above the data's peak, so the top tick reads as a scale
 *  rather than as a data point. */
function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / magnitude) * magnitude;
}

/** A tick the way a person writes it. `niceMax` works in floats, so 0.5 comes
 *  back as 0.5000000000000001 often enough to matter on a 240px drawing. */
function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function ChatMiniChart({ block, labels }: { block: ChatChartBlock; labels: ChatBlockLabels }) {
  const { series, x, y, kind, title } = block;
  const count = x.values.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const slot = PLOT_W / Math.max(count, 1);
  const valueY = (value: number) => BASE_Y - (Math.max(0, value) / max) * PLOT_H;
  const centerX = (index: number) => PAD_L + slot * (index + 0.5);

  return (
    <figure className="animate-fade-in mt-2 w-full max-w-full">
      {title ? <figcaption className="pb-1 text-meta uppercase text-steel">{title}</figcaption> : null}
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white p-2 dark:rounded-2xl">
        {/* The vertical axis is named in HTML rather than as rotated SVG text:
            rotated 14px in a 240px drawing is unreadable, and real text is
            selectable and translatable. */}
        <p className="pb-0.5 text-meta uppercase text-steel">{y.label}</p>
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={title ?? labels.chart}
          className="max-w-full text-meta"
        >
          {/* Two value ticks — zero and the scale top. A grid of five lines in
              96px is texture, not information. */}
          {[0, max].map((value) => (
            <g key={value}>
              <line x1={PAD_L} x2={WIDTH - PAD_R} y1={valueY(value)} y2={valueY(value)} stroke={AXIS} strokeWidth={1} />
              <text x={PAD_L - 4} y={valueY(value) + 4} textAnchor="end" fill={TICK_TEXT} fontSize={14}>
                {formatTick(value)}
              </text>
            </g>
          ))}

          {kind === "bar"
            ? series.map((entry, seriesIndex) => {
                // Two series share a slot side by side; one owns it centred.
                const width = series.length > 1 ? slot * 0.32 : slot * 0.56;
                const offset = series.length > 1 ? (seriesIndex - 0.5) * width : 0;
                return (
                  <g key={entry.label} fill={SERIES_COLORS[seriesIndex]}>
                    {entry.values.map((value, index) => (
                      <rect
                        key={index}
                        x={centerX(index) + offset - width / 2}
                        y={valueY(value)}
                        width={Math.max(width, 1)}
                        height={Math.max(BASE_Y - valueY(value), 1)}
                        rx={2}
                      />
                    ))}
                  </g>
                );
              })
            : series.map((entry, seriesIndex) => (
                <g key={entry.label}>
                  <polyline
                    fill="none"
                    stroke={SERIES_COLORS[seriesIndex]}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={entry.values.map((value, index) => `${centerX(index)},${valueY(value)}`).join(" ")}
                  />
                  {entry.values.map((value, index) => (
                    <circle key={index} cx={centerX(index)} cy={valueY(value)} r={2.5} fill={SERIES_COLORS[seriesIndex]} />
                  ))}
                </g>
              ))}

          {tickIndexes(count).map((index) => (
            <text
              key={index}
              x={centerX(index)}
              y={BASE_Y + 18}
              // The end ticks anchor inward so a long category cannot run off
              // the drawing.
              textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
              fill={TICK_TEXT}
              fontSize={14}
            >
              {x.values[index]}
            </text>
          ))}
        </svg>
        <p className="text-meta uppercase text-steel">{x.label}</p>
        {series.length > 1 ? (
          <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {series.map((entry, index) => (
              <li key={entry.label} className="flex items-center gap-1.5 text-sm text-steel">
                {/* An SVG swatch, not a styled span: a presentation attribute is
                    parsed as CSS, so the token resolves per theme with no inline
                    color literal anywhere. */}
                <svg aria-hidden width={10} height={10} viewBox="0 0 10 10" className="shrink-0">
                  <rect width={10} height={10} rx={2} fill={SERIES_COLORS[index]} />
                </svg>
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </figure>
  );
}
