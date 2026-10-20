"use client";

import { useCallback, useRef, useState } from "react";
import { isDragActive, nextDragDepth, type DragCounterEvent } from "./analyzeDragCounter";

/**
 * The counted drag highlight shared by the Analyze upload zones (the JD/company
 * zone and the empty CV zone). Highlight ONLY: inside the Analyze form a zone never
 * commits a drop — the one window listener AnalyzeForm hosts reads the zone id off
 * `data-file-dropzone` and plans the whole drop (challenge-r03 cv-analyze-intake/A).
 * A zone rendered OUTSIDE that form (the /me profile import) passes `onDropFiles` to
 * take its own drop, since no router is listening there.
 *
 * The highlight is COUNTED, not a boolean. Each zone is a label wrapping an icon,
 * a title and a hint, and dragenter/dragleave fire for every one of them, so the
 * old `setIsOver(false)` on leave made the highlight strobe as the cursor crossed
 * the zone's own children — flickering "will not accept" at a user who had not
 * left the target. `analyzeDragCounter` holds the arithmetic (and its terminal
 * resets); this hook is the React binding. Returns `isOver` for the idle/active
 * styling and `dragProps` to spread onto the drop-target element.
 */
export function useDropZoneHighlight(onDropFiles?: (files: File[]) => void) {
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
    // The event keeps bubbling, so a hosting form's window router still sees it.
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      step("drop");
      if (onDropFiles) onDropFiles(Array.from(event.dataTransfer.files ?? []));
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
