import { AcceptForm } from "./AcceptForm";

// PUBLIC invite-accept page (proxy allow-listed). Thin server shell — the client
// form fetches its own preview from GET /api/invite/[token]. Awaiting `params`
// for a per-token route is request-scoped, so under Next 16.3 Cache Components
// this route opts out of instant prerendering (matching the other [token] pages);
// loading.tsx still provides the navigation loading state.
export const instant = false;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptForm token={token} />;
}
