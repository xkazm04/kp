// The Campaign tab's (job, language) request identity, extracted from
// jobsCampaignTabLogic so the staleness rule is pinned rather than described.
import type { PackRecord } from "./jobsCampaignTabTypes";

/** One fetch per (job, language) pair; a response is applied only while its key
 *  is still the current one, so a quick language toggle cannot clobber. */
export function campaignPackKey(jobId: string, lang: string): string {
  return `${jobId}|${lang}`;
}

/** What may stay on screen after the load for `key` failed. A pack that does NOT
 *  belong to that key is dropped: the tab renders the error banner and the stored
 *  pack side by side and nothing in a pack names its language, so a recruiter who
 *  toggled cs → de into a 500 saw Czech ad copy under a lit "DE" toggle and could
 *  "Copy all" it onto a German board. A failed reload of the SAME pair keeps what
 *  is already correct — a refresh never blanks right content (loading
 *  choreography law 2). */
export function packSurvivingFailure(prev: PackRecord | null, key: string): PackRecord | null {
  return prev && campaignPackKey(prev.jobId, prev.lang) === key ? prev : null;
}
