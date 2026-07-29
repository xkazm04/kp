"use client";

import { useState } from "react";

/**
 * The drag-highlight + drop-commit boilerplate shared by the two empty Analyze
 * upload zones (the JD/company drop zone and the empty CV zone). Both rolled their
 * own `isOver` state plus the four `preventDefault` handlers and the
 * commit-the-first-dropped-file `onDrop`; this hook owns that one behavior so a
 * future drag fix can't land in only one zone.
 *
 * `commit` is the per-zone choke point (`accept(file, onFileChange)` for the JD
 * zone, `addFile` for the CV zone) — the drop routing carve-out (`ownedDropZoneProps`)
 * and each zone's own class swap stay at the call site. Returns `isOver` for the
 * idle/active styling and `dragProps` to spread onto the drop-target element.
 */
export function useDropZoneHighlight(commit: (file: File) => void) {
  const [isOver, setIsOver] = useState(false);

  const dragProps = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(true);
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setIsOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) commit(file);
    },
  };

  return { isOver, dragProps };
}
