import { redirect } from "next/navigation";

// /me/jobs — the feed now lives on the flow itself, as the "Worth your evening" step
// (docs/features/jobseeker/README.md, "The flow"). Kept as an address so bookmarks and
// old links land where the ranking went.
export default function JobsPage(): never {
  redirect("/me#s-evening");
}
