import { AcceptForm } from "./AcceptForm";

// PUBLIC invite-accept page (proxy allow-listed). Thin server shell — the client
// form fetches its own preview from GET /api/invite/[token], so this route stays
// static-friendly (no request-scoped server rendering) under Next 16.3.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptForm token={token} />;
}
