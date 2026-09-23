"use client";

import { useEffect, useRef, useState } from "react";
import { nextDragDepth, isDragActive, type DragCounterEvent } from "./analyzeDragCounter";
import { resolveDropZone, type DropTarget } from "./analyzeDropRouting";

/** One window drop, as the router needs it: where it landed, what it carried, and
 *  whether it was a file drag at all (a text-selection drag is never routed). */
export type WindowDrop = { zone: DropTarget; files: File[]; isFileDrag: boolean };

// The ONE window-level drop listener of the Analyze form (challenge-r03
// cv-analyze-intake/A). AnalyzeForm hosts it; a zone never commits a drop itself.
// Every file drop anywhere on the page ends here: it resolves the zone id of the
// nearest marked ancestor and hands the whole drop to the form's router. Returns true
// while a file drag is active anywhere on the page, which drives the overlay and the
// zones' "drop here" styling.
export function useGlobalFileDrag(onDrop: (drop: WindowDrop) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    // The same enter/leave arithmetic the zones use (analyzeDragCounter.ts), with its
    // clamp at zero and its terminal resets on drop and dragend.
    let depth = 0;

    function isFileDrag(event: DragEvent): boolean {
      const types = event.dataTransfer?.types;
      return types ? Array.from(types).includes("Files") : false;
    }

    function step(event: DragCounterEvent) {
      depth = nextDragDepth(depth, event);
      setIsDragging(isDragActive(depth));
    }

    function handleDragEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      step("enter");
    }

    function handleDragLeave() {
      // NOT gated on isFileDrag: several browsers report an EMPTY dataTransfer.types
      // during dragleave, so gating here would skip the balancing decrement and the
      // overlay would stick. A stray leave merely clamps the depth at 0.
      step("leave");
    }

    function handleDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
      // A drop always ends the drag — clear the overlay regardless of payload type OR
      // where it landed (external file drags fire no balancing dragleave/dragend).
      const fileDrag = isFileDrag(event);
      step("drop");
      // Stop the browser opening the file for ANY file drag on the page.
      if (fileDrag) event.preventDefault();
      // Snapshot the FileList now: it is only readable during dispatch.
      onDropRef.current({
        zone: resolveDropZone(event.target),
        files: Array.from(event.dataTransfer?.files ?? []),
        isFileDrag: fileDrag,
      });
    }

    // `dragend` fires when a drag operation ends (incl. ESC-cancel / off-window
    // release for in-page sources) — the backstop a counter without resets lacks.
    function handleDragEnd() {
      step("end");
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("dragend", handleDragEnd);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragend", handleDragEnd);
    };
  }, []);

  return isDragging;
}
