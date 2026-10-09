import { useId } from "react";
import type { CohortDimension } from "../../cohortTypes";
import { KNOT_H, RIGHT, cutPaths, floatPath, selvedgePath, slackAmp, tasselPath, warpPath, weftPath, type LoomGeo } from "./loomGeometry";
import { passesBehind, type RowReading, type Thread } from "./loomModel";

type Row = { dimension: CohortDimension; reading: RowReading };

/**
 * The loom's drawing (decorative: every thread, row and knot has its control laid over it). The beam
 * at the top, the weft rows with their tie-offs and the loose floats over a row's noise group, the warp
 * threads (taut, slack, still spinning, or cut), the selvedge of a clearing leader, and the cloth the
 * narrative's threads continue into while the others end in a tassel. A warp's `d` is set through CSS
 * so the slack thread of a decoy visibly pulls taut while it is read, and threads glide when re-hung.
 */
export function LoomThreads({ geo, threads, rows, hotCol, hotRow, cloth }: {
  geo: LoomGeo;
  threads: readonly Thread[];
  rows: readonly Row[];
  hotCol: number | null;
  hotRow: number | null;
  /** The cloth is woven (a narrative exists). */
  cloth: boolean;
}) {
  const weave = useId().replace(/:/g, "");
  const left = geo.gutter - 14;
  const right = geo.width - RIGHT + 18;
  const amp = slackAmp(geo.pitch);
  return (
    <svg className="lm-threads" width={geo.width} height={geo.height} viewBox={`0 0 ${geo.width} ${geo.height}`} aria-hidden focusable="false">
      <defs>
        <pattern id={weave} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect className="lm-cloth__a" width="8" height="8" />
          <path className="lm-cloth__b" d="M0 2h4M4 6h4" />
        </pattern>
      </defs>
      <rect className="lm-beam" x={left - 6} y={geo.beam - 7} width={right - left + 12} height={12} rx={6} />
      {cloth ? <rect className="lm-cloth" x={left} y={geo.fell} width={right - left} height={geo.clothEnd - geo.fell} rx={4} fill={`url(#${weave})`} /> : null}
      <path className="lm-fell" d={`M${left} ${geo.fell}L${right} ${geo.fell}`} data-woven={cloth || undefined} />
      {rows.map((row, r) => (
        <g key={row.dimension} className="lm-row" data-dim={row.dimension} data-hot={hotRow === r || undefined} data-kind={row.reading.kind}>
          <path className="lm-weft" d={weftPath(geo, geo.ys[r])} />
          <circle className="lm-tie" cx={geo.width - RIGHT + 16} cy={geo.ys[r]} r={4} />
        </g>
      ))}
      {threads.map((th) => {
        const x = geo.xs[th.col];
        const hot = hotCol === th.col;
        if (th.state === "failed") {
          const cut = cutPaths(x, geo.beam);
          return (
            <g key={th.member.memberId} className="lm-warp-g" data-state="failed" data-hot={hot || undefined}>
              <path className="lm-warp" d={cut.stub} />
              <path className="lm-fray" d={cut.fray} />
            </g>
          );
        }
        const end = th.covered && cloth ? geo.clothEnd : geo.fell;
        const behind = rows.map((row) => passesBehind(th.member.cells[row.dimension]));
        const d = warpPath(x, geo, end, behind, th.slack && !hot ? amp : 0);
        return (
          <g key={th.member.memberId} className="lm-warp-g" data-state={th.state} data-slack={th.slack || undefined} data-hot={hot || undefined} data-covered={th.covered || undefined}>
            {th.selvedge ? <path className="lm-selvedge" d={selvedgePath(x, geo.beam + 8, end)} /> : null}
            <path className="lm-warp" d={d} style={{ d: `path("${d}")` }} />
            {th.covered && cloth ? null : <path className="lm-tassel" d={tasselPath(x, end)} />}
          </g>
        );
      })}
      {rows.map((row, r) => {
        if (row.reading.kind !== "insideNoise") return null;
        const ids = new Set(row.reading.noise);
        const xs = threads.filter((th) => ids.has(th.member.memberId)).map((th) => geo.xs[th.col]);
        const d = floatPath(xs, geo.ys[r], KNOT_H.strong);
        return d ? <path key={row.dimension} className="lm-float" d={d} style={{ d: `path("${d}")` }} /> : null;
      })}
    </svg>
  );
}
