import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { listJobseekerSources } from "@/app/_lib/db/jobseeker-sources";
import { sourcesCatalog } from "@/app/_lib/jobseeker/sources-catalog";
import { SourcesPage } from "@/app/features/jobseeker/SourcesPage";
import { SieveSideFrame } from "@/app/features/jobseeker/sieve/SieveSideFrame";

// /me/sources — the three-tier acquisition list (docs/features/jobseeker/README.md,
// "Feed, fit dialog, sources UI"). The layout is the gate.
//
// SERVER-FIRST, the shape /me and /me/jobs already use: this page reads the research
// catalog and THIS workspace's rows here and hands them down as `initial`, so the tiers
// paint on the first frame. It used to render a client-only fetcher with no props, so
// every navigation to it flashed a three-card grey skeleton while its two siblings
// painted instantly — the inconsistency read as breakage (loading-choreography.md:
// "chrome always renders", "no skeletons").
//
// The client still owns every WRITE and re-reads the same GET in the background, so the
// snapshot below is a first frame, never a cache the writes outrun.
export const instant = false;

export default async function MeSourcesPage() {
  const ws = await currentWorkspace();
  // Beside the flow, in its frame: the flow's Sources step switches the catalog on and
  // off; this page keeps the doors it does not — a board by host, an ATS by company slug,
  // extraction rules and their preview.
  return (
    <SieveSideFrame page="sources">
      <SourcesPage initial={{ catalog: sourcesCatalog(), sources: listJobseekerSources(ws) }} />
    </SieveSideFrame>
  );
}
