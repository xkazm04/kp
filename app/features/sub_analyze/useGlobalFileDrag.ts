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

    function handleDragEnter(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragCounter += 1;
      if (dragCounter === 1) setIsDragging(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (!isFileDrag(event)) return;
      dragCounter -= 1;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDragging(false);
      }
    }

    function handleDragOver(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragCounter = 0;
      setIsDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) onDropRef.current(file);
    }

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  return isDragging;
}
