import { ScansPage } from "@/app/features/jobseeker/ScansPage";

// /me/scans — the seeker's view of the shared scheduler registry's `jobseeker_scan`
// job (docs/features/jobseeker/README.md, "Scheduler"). The layout is the gate; the
// client page reads GET /api/automation/schedule and filters `jobs[]` to the one job.
export const instant = false;

export default function MeScansPage() {
  return <ScansPage />;
}
