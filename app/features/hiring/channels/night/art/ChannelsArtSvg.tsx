import type { ReactNode } from "react";

/**
 * The frame every district drawing shares: decorative (aria-hidden, never focusable; the plate
 * beside it carries the words), sized by its container, named `cn-art--<name>` so the scene
 * stylesheet can reach its parts. The drawings are stylised; they state nothing the plate does not.
 */
export function ArtSvg({ viewBox, name, children }: { viewBox: string; name: string; children: ReactNode }) {
  return (
    <svg viewBox={viewBox} className={`cn-art cn-art--${name}`} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
