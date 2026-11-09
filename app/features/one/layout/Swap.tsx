"use client";

// One region that shows ONE thing at a time and changes it with a CROSSFADE in place
// (docs/design/one-interface.md "Motion orchestration"): the leaving and the arriving child
// share one grid cell, so neither leaves the flow.
//
// Why not the other AnimatePresence modes here:
//   - `popLayout` takes the leaving node out of flow at once, so the region's neighbours
//     jump to the arriving node's size before it has painted (the round-4 jump);
//   - `wait` holds the next view back until the old one has gone — an empty beat between
//     two answers, which reads as a blink.
// `sync` in one stacked cell keeps the region's box. The two barely overlap: the leaver
// fades in 60 ms (motion.ts LEAVE) and the arriver's OPACITY waits 40 ms before it rises
// (its move starts at once), so two lines of text are never both half-visible on top of each
// other (a ghosted double) — the crossfade reads as one change, not a flicker.
//
// The child is keyed by IDENTITY (`id`): the same view / person / answer keeps the same
// child, so it stays mounted and nothing moves. `spec` is chosen once, when the child mounts
// (it is told whether the seen-record knows `id`), so a re-render never changes a running
// move under it.
//
// The child the region MOUNTS with does not move (it is part of the region's own arrival).
// That is the item's own `initial={false}` — NOT AnimatePresence's `initial={false}`, which
// reaches every motion element below through the presence context and would block a table's
// first-arrival cascade deep inside the view (measured: the side list's rows never moved).
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import type { MotionSpec } from "../motion";
import { oneSeen } from "../panels/seen";

const CELL = "col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col";

/** The arriver's fade, held back until the leaver is mostly gone. */
const ARRIVE_OPACITY = { duration: 0.1, delay: 0.04, ease: "easeOut" } as const;

function SwapItem({ id, first, spec, className, children }: { id: string; first: boolean; spec: (seen: boolean) => MotionSpec; className: string; children: ReactNode }) {
  const [move] = useState((): MotionSpec => {
    const m = spec(oneSeen.seen(id));
    return first ? { ...m, initial: false } : { ...m, transition: { ...m.transition, opacity: ARRIVE_OPACITY } };
  });
  return (
    <motion.div className={`${CELL} ${className}`} {...move}>
      {children}
    </motion.div>
  );
}

export function Swap({
  id,
  spec,
  className = "",
  itemClassName = "",
  children,
  ...rest
}: {
  id: string;
  spec: (seen: boolean) => MotionSpec;
  className?: string;
  itemClassName?: string;
  children: ReactNode;
} & { [data: `data-${string}`]: string | boolean | undefined }) {
  // The id the region mounted with — forgotten at the first change, so coming back to it later
  // is a change like any other.
  const [firstId, setFirstId] = useState<string | null>(id);
  if (firstId !== null && id !== firstId) setFirstId(null);
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] ${className}`} {...rest}>
      <AnimatePresence>
        <SwapItem key={id} id={id} first={id === firstId} spec={spec} className={itemClassName}>
          {children}
        </SwapItem>
      </AnimatePresence>
    </div>
  );
}
