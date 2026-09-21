import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { ProfilePage } from "@/app/features/jobseeker/ProfilePage";

// /me — Profile & CV studio (docs/features/jobseeker/README.md, "Profile and CV
// studio"). The layout is the gate; this page reads the seeker's row once on the
// server (the same identity split the API uses: user id when the session has one,
// else the workspace's single seeker) and hands it to the client page, which owns
// the import flow, the summary and the studio from there.
export const instant = false;

export default async function MeHomePage() {
  const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
  const profile = getJobseekerProfile(currentUserId(session), ws);
  return <ProfilePage initial={profile} />;
}
