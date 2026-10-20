// The profile every SCORING reader uses (the scan, the on-demand deep-dive): the seeker's
// own, plus the GitHub evidence they confirmed and chose to use (githubEvidence.ts
// matcherProfile). One helper so the two readers can never see different inputs.

import { getGithubState } from "../db/jobseeker-ui-state";
import { githubStateOf, matcherProfile } from "./githubEvidence";
import type { JobseekerProfile } from "./types";

export function withGithubEvidence(profile: JobseekerProfile, workspaceId: string): JobseekerProfile {
  const entry = getGithubState(profile.id, workspaceId);
  return matcherProfile(profile, githubStateOf(entry?.value), entry?.updatedAt ?? null);
}
