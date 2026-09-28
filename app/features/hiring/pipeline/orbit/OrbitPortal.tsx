"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noSubscription = () => () => undefined;

/**
 * Render a fixed layer (the flight canvas, the drawer) on document.body. Inside the tab panel a
 * `position: fixed` element is contained by the panel's entrance transform, not the viewport (the
 * journey board shipped 1264x0 for exactly that reason), so it would miss the sidebar and offset
 * every viewport coordinate the flight measures. The `k-kit` wrapper carries the kit's variables
 * across the portal.
 */
export function OrbitPortal({ children }: { children: ReactNode }) {
  const root = useSyncExternalStore(noSubscription, () => document.body, () => null);
  if (!root) return null;
  return createPortal(<div className="k-kit">{children}</div>, root);
}
