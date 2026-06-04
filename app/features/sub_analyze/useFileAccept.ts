"use client";

import { useCallback, useState } from "react";
import { acceptUpload } from "@/app/_lib/upload-constraints";

/**
 * The single intake gate for the Analyze workspace. Every File entry point —
 * the empty drop zone, the Replace input, the Add-variant input, and the
 * drop-anywhere overlay — calls `accept(file, commit)` instead of committing the
 * File to state itself. `accept` runs the shared `acceptUpload` check and only
 * invokes `commit` when the File clears extension + size; otherwise it surfaces
 * the inline `error`. Funnelling every path through this one hook is what makes
 * "no intake bypasses validation" a checkable contract rather than three
 * near-identical copies that can drift apart.
 */
export function useFileAccept() {
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback((file: File, commit: (file: File) => void) => {
    const result = acceptUpload(file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    commit(result.file);
  }, []);

  return { error, accept };
}
