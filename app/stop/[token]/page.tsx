import { StopClient } from "./StopClient";

// Token-gated unsubscribe page — inherently per-request (it reads the token param and
// fetches the candidate's contact state client-side), so there is no useful static shell
// to prerender. Block it under Cache Components. `instant` is route segment config, so
// it must live on this Server Component wrapper; the interactive UI stays in the
// "use client" StopClient child. Same shape as the sibling /data/[token] door.
export const instant = false;

export default function StopPage() {
  return <StopClient />;
}
