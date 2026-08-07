import { DataClient } from "./DataClient";

// The GDPR self-service page is token-gated and inherently per-request (it reads
// the token param and fetches the candidate's data client-side), so there is no
// useful static shell to prerender. Block it under Cache Components. `instant` is
// route segment config, so it must live on this Server Component wrapper; the
// interactive UI stays in the "use client" DataClient child. (The sibling
// loading.tsx still provides the navigation loading state.)
export const instant = false;

export default function DataPage() {
  return <DataClient />;
}
