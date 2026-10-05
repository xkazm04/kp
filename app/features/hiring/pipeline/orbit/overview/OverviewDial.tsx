"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Halos, ScenePress } from "@/app/_components/kit/scene";
import { useTheme } from "@/app/_components/ui/useTheme";
import type { OrbitGeo } from "../orbitLayout";
import { drawOrbit, readPalette } from "../orbitPaint";
import type { OverviewSnap } from "./overviewParts";

export type OverviewDialHandle = {
  snapshot: () => OverviewSnap | null;
  /** The canvas's box on screen (the wires measure the orbit's centre from it). */
  box: () => DOMRect | null;
};

type Props = {
  geo: OrbitGeo;
  /** What each ring's slot at 12 o'clock says (the ring's count), outside in. */
  ringLabels: readonly string[];
  /** The people a queue (or the waiting count, or First up) points at: lit, with breathing halos. */
  focus: ReadonlySet<string> | null;
  /** A lit set that waits on a human breathes coral; one merely in motion breathes in the calm ink. */
  needs: boolean;
  hotRing: number | null;
  label: string;
  onOpen: () => void;
};

/**
 * The Overview's orbit: THE orbit (the same layoutOrbit over the same groups and lens, cut by its
 * people), drawn small inside one press that opens it (the kit's `ScenePress`, painted by orbitOverview.css `.ov-dial`). Every dot is a person the full orbit also
 * draws, so opening it is a flight of these very dots (OrbitStage's "grow" arrival). The lit people
 * get the kit's breathing halo while they are pointed at (a state, never ambient; still under reduced
 * motion, where the CSS drops the animation).
 */
export const OverviewDial = forwardRef<OverviewDialHandle, Props>(function OverviewDial({ geo, ringLabels, focus, needs, hotRing, label, onOpen }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsTick((v) => v + 1)).catch(() => { /* fonts API absent: the first paint stands */ });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!cv.current) return;
    drawOrbit(cv.current, geo, readPalette(), { hot: null, ring: hotRing, places: [], height: geo.H, ringLabels, focus });
  }, [geo, ringLabels, focus, hotRing, theme, fontsTick]);

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      if (!cv.current) return null;
      const r = cv.current.getBoundingClientRect();
      const from = new Map<string, { x: number; y: number; r: number }>();
      for (const d of geo.dots) from.set(d.p.id, { x: r.left + d.x, y: r.top + d.y, r: d.r });
      return { from, origin: { cx: r.left + geo.cx, cy: r.top + geo.cy, R: geo.R } };
    },
    box: () => cv.current?.getBoundingClientRect() ?? null,
  }), [geo]);

  const lit = focus ? geo.dots.filter((d) => focus.has(d.p.id)) : [];
  return (
    <ScenePress className="ov-dial" onClick={onOpen} aria-label={label} data-role="orbit-core" style={{ width: geo.W, height: geo.H }}>
      <canvas ref={cv} aria-hidden />
      <Halos points={lit.map((d) => ({ id: d.p.id, x: d.x, y: d.y, r: d.r }))} width={geo.W} height={geo.H} calm={!needs} />
    </ScenePress>
  );
});
