import { ControlRoom } from "./ControlRoom";

// The control room polls live server state client-side and renders under the
// per-request locale layout, so it is inherently dynamic — there is no useful
// static shell to prerender. Block it under Cache Components (its behavior
// before the flag). `instant` is route segment config, so it must live on this
// Server Component wrapper; the interactive UI stays in the "use client"
// ControlRoom child.
export const instant = false;

export default function ControlPage() {
  return <ControlRoom />;
}
