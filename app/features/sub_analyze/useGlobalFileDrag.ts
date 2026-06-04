"use client";

import { useEffect, useRef, useState } from "react";

// Listens for window-level drag events so the CV dropzone can highlight even
// before the cursor enters its bounding box. Returns true while a file drag
// is active anywhere on the page.
export function useGlobalFileDrag(onDrop: (file: File) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    let dragCounter = 0;

    function isFileDrag(event: DragEvent): boolean {
      const types = event.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i++) {
        if (types[i] === "Files") return true;
      }
      return false;
    }

    // Hard-reset the drag state. The counter-without-a-terminal-reset pattern is a
    // known footgun: an ESC-canceled drag or a file released OUTSIDE the window may
    // never fire the balancing dragleave/drop, so we also reset on `dragend` and
    // clamp defensively — the overlay can never get stuck open.
    function reset() {
      dragCounter = 0;
      setIsDragging(false);
    }

    function handleDragEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragCounter += 1;
      if (dragCounter === 1) setIsDragging(true);
    }

    function handleDragLeave() {
      // NOT gated on isFileDrag: several browsers report an EMPTY dataTransfer.types
      // during dragleave, so gating here would skip the balancing decrement and the
      // overlay would stick. A stray leave merely clamps the counter at 0.
      dragCounter -= 1;
      if (dragCounter <= 0) reset();
    }

    function handleDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
      // A drop always ends the drag — clear the overlay regardless of payload type.
      const fileDrag = isFileDrag(event);
      reset();
      if (!fileDrag) return;
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) onDropRef.current(file);
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    // `dragend` fires when a drag operation ends (incl. ESC-cancel / off-window
    // release for in-page sources) — the backstop the original hook lacked.
    window.addEventListener("dragend", reset);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  return isDragging;
}
