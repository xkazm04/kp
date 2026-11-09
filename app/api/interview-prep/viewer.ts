// Who is reading a human scorecard panel, resolved ONCE per request for every reader that
// passes the panel through projectForViewer (human-scorecard-set.ts). Server-only: it asks
// the session. Never throws; a caller whose identity cannot be resolved is `null`, which the
// projection treats as the fail-closed viewer (no colleague's record).
import { can, currentUser } from "@/app/_lib/auth/current-user";
import { getUserById } from "@/app/_lib/db/users";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import type { InterviewPrep } from "@/app/_lib/interview-prep";
import { projectPrepPayload, type ScorecardViewer } from "@/app/_lib/human-scorecard-set";

export async function resolveScorecardViewer(): Promise<ScorecardViewer | null> {
  try {
    const { userId } = await currentUser();
    const user = userId ? getUserById(userId) : null;
    return { author: userId, authorLabel: user ? (user.name ?? user.email) : null, canManage: await can("team:manage") };
  } catch (error) {
    console.warn("[interview-prep:viewer] caller unresolved; answering as no one", error);
    return null;
  }
}

/** A prep artifact as THIS caller may read it: the panel and its headline mirror projected
 *  for the round the entry is in now. */
export function prepForViewer<T extends Pick<InterviewPrep, "payload">>(
  prep: T | null,
  entryId: string,
  ws: string,
  viewer: ScorecardViewer | null,
): T | null {
  if (!prep) return null;
  const stage = getPipelineEntry(entryId, ws)?.stage ?? null;
  return { ...prep, payload: projectPrepPayload(prep.payload, viewer, stage) };
}
