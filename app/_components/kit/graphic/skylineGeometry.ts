/*
 * The Skyline's pure geometry: ranked items become bars (one per item while a bar stays >= 3px wide,
 * binned beyond that), a null value becomes a dashed stub at the end ("never scored", counted, never
 * drawn as 0), and a rank range becomes a brush. Also the keyboard's next focus. No DOM: node:test.
 */

export type SkyItem = { id: string; value: number | null; label: string; needs?: boolean };

export const SKY = { left: 36, right: 8, top: 14, bottom: 22, minBar: 3, maxBar: 14, nullValue: 12 } as const;

export type SkyGeometry = {
  width: number;
  height: number;
  /** Items per column (1 until bars would drop under 3px). */
  per: number;
  columns: number;
  /** Column pitch and bar width, px. */
  step: number;
  barWidth: number;
};

export function skyGeometry(count: number, width: number, height: number): SkyGeometry {
  const plot = Math.max(0, width - SKY.left - SKY.right);
  const maxBars = Math.max(1, Math.floor(plot / SKY.minBar));
  const per = count > maxBars ? Math.ceil(count / maxBars) : 1;
  const columns = Math.ceil(count / per);
  const step = plot / Math.max(1, columns);
  return { width, height, per, columns, step, barWidth: Math.max(2, Math.min(SKY.maxBar, step * 0.72)) };
}

/** A value's y on the 0..100 axis. */
export function skyY(g: Pick<SkyGeometry, "height">, v: number): number {
  return SKY.top + ((100 - v) / 100) * (g.height - SKY.top - SKY.bottom);
}

/** Column `ci`'s bar box: a real value grows from the axis; a null is a fixed stub up to 12. */
export function barBox(g: SkyGeometry, ci: number, value: number | null): { x: number; y: number; w: number; h: number } {
  const x = SKY.left + ci * g.step + (g.step - g.barWidth) / 2;
  const top = skyY(g, value == null ? SKY.nullValue : value);
  const h = value == null ? skyY(g, 0) - top : Math.max(2, skyY(g, 0) - top);
  return { x, y: top, w: g.barWidth, h };
}

/** The brush rectangle for a rank range [a, b] (inclusive, item ranks, not columns). */
export function brushBox(g: SkyGeometry, range: readonly [number, number]): { x: number; w: number } {
  const c0 = Math.floor(range[0] / g.per);
  const c1 = Math.floor(range[1] / g.per);
  return { x: SKY.left + c0 * g.step, w: (c1 - c0 + 1) * g.step };
}

/** Whether column `ci` falls inside a brush (no brush: everything is in). */
export function inBrush(g: SkyGeometry, ci: number, range: readonly [number, number] | null | undefined): boolean {
  if (!range) return true;
  const rank = ci * g.per;
  return rank >= range[0] && rank <= range[1];
}

/** The item rank under a pointer x (px from the svg's left edge), clamped to the items. */
export function rankAt(g: SkyGeometry, x: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor((x - SKY.left) / Math.max(1e-6, g.step)) * g.per));
}

/** Items with no value, and where their stubs start (the x of the first null column). */
export function nullRun(items: readonly SkyItem[], g: SkyGeometry): { count: number; x: number } {
  const count = items.filter((q) => q.value == null).length;
  return { count, x: SKY.left + ((items.length - count) / g.per) * g.step };
}

/*
 * Fewer labels on a narrow sheet, never fewer bars. The y axis drops its middle tick under 640px; the
 * null run's label ("35 never scored · not zero") ends at the plot's right edge once the run starts in
 * the right 45% (it used to run off the edge); "rank 1" stays only while it cannot touch that label.
 */
export const NULL_LABEL_PX = 190;
export function skyTicks(width: number): number[] {
  return width < 640 ? [0, 100] : [0, 50, 100];
}
export function nullLabelAt(x: number, width: number): { x: number; textAnchor: "start" | "end" } {
  return x > width * 0.55 ? { x: width - SKY.right, textAnchor: "end" } : { x: x + 4, textAnchor: "start" };
}
export function showRankOne(nullX: number, width: number): boolean {
  const labelStart = nullLabelAt(nullX, width).textAnchor === "end" ? width - SKY.right - NULL_LABEL_PX : nullX + 4;
  return labelStart - SKY.left > 64;
}

/** Arrow keys move one item, Alt moves ten, Home/End jump; the result stays inside the items. */
export function nextFocus(focus: number, key: string, alt: boolean, count: number): number | null {
  const last = count - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "ArrowRight" || key === "ArrowLeft") return Math.max(0, Math.min(last, focus + (key === "ArrowRight" ? 1 : -1) * (alt ? 10 : 1)));
  return null;
}

/** The growth stagger: <= 5ms per column, the whole sweep inside ~520ms. */
export const growDelay = (ci: number, columns: number) => Math.round(ci * Math.min(5, 520 / Math.max(1, columns)));
