import { redirect } from "next/navigation";

// /me/jobs/[id] — one posting is the flow's Weigh step now (docs/features/jobseeker/
// README.md, "The flow"): the address opens the flow with that posting open. The id is
// passed through as a query value, never interpreted here; the Weigh step reads the
// posting through GET /api/jobseeker/postings/[id], which binds the workspace.
export default async function PostingPage({ params }: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await params;
  redirect(`/me?open=${encodeURIComponent(id)}#s-weigh`);
}
