import { SourcesPage } from "@/app/features/jobseeker/SourcesPage";

// /me/sources — the three-tier acquisition list (docs/features/jobseeker/README.md,
// "Feed, fit dialog, sources UI"). The layout is the gate; the client page reads
// GET /api/jobseeker/sources itself, because every control on it writes back through
// the same API and one reader is simpler than a server snapshot the writes outrun.
export const instant = false;

export default function MeSourcesPage() {
  return <SourcesPage />;
}
