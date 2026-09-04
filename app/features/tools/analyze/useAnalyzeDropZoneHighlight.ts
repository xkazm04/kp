"use client";

import { useCallback, useRef, useState } from "react";
import { isDragActive, nextDragDepth, type DragCounterEvent } from "./analyzeDragCounter";

/**
 * The drag-highlight + drop-commit boilerplate shared by the two empty Analyze
 * upload zones (the JD/company drop zone and the empty CV zone). Both rolled their
 * own `isOver` state plus the four `preventDefault` handlers and the
 * commit-the-first-dropped-file `onDrop`; this hook owns that one behavior so a
 * future drag fix can't land in only one zone.
 *
 * The highlight is COUNTED, not a boolean. Each zone is a label wrapping an icon,
 * a title and a hint, and dragenter/dragleave fire for every one of them, so the
 * old `setIsOver(false)` on leave made the highlight strobe as the cursor crossed
 * the zone's own children — flickering "will not accept" at a user who had not
 * left the target. `analyzeDragCounter` holds the arithmetic (and its terminal
 * resets); this hook is the React binding.
 *
 * `commit` is the per-zone choke point (`accept(file, onFileChange)` for the JD
 * zone, `addFile` for the CV zone) — the drop routing carve-out (`ownedDropZoneProps`)
 * and each zone's own class swap stay at the call site. Returns `isOver` for the
 * idle/active styling and `dragProps` to spread onto the drop-target element.
 */
export function useDropZoneHighlight(commit: (file: File) => void) {
  // The depth lives in a ref as well as state: handlers fire many times per
  // second during a drag and must each see the PREVIOUS handler's result, which a
  // state value captured in this render would not give them.
  const depthRef = useRef(0);
  const [isOver, setIsOver] = useState(false);

  const step = useCallback((event: DragCounterEvent) => {
    depthRef.current = nextDragDepth(depthRef.current, event);
    setIsOver(isDragActive(depthRef.current));
  }, []);

  const dragProps = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      step("enter");
    },
    // dragover fires continuously and is NOT a depth change — it only keeps the
    // browser from treating the zone as a non-target. Counting it would inflate
    // the depth by hundreds and no number of leaves would ever clear it.
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
    },
    onDragLeave: (event: React.DragEvent) => {
      event.preventDefault();
      step("leave");
    },
    // A drop ends the drag outright — reset rather than decrement, since the
    // balancing leaves for the children the cursor is still inside never arrive.
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      step("drop");
      const file = event.dataTransfer.files?.[0];
      if (file) commit(file);
    },
    // The backstop for an ESC-cancelled drag or a release outside the window,
    // which send no balancing dragleave at all (the same gap the window-level
    // hook closes with its own `dragend` listener). Without it the zone could
    // stay highlighted with nothing being dragged.
    onDragEnd: (event: React.DragEvent) => {
      event.preventDefault();
      step("end");
    },
  };

  return { isOver, dragProps };
}
