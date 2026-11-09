// Test support: a held first-contact letter a NAMED person approved, for tests that drive the
// outreach send seam (comms-dispatch.ts dispatchOutreach) directly. The seam sends only an
// approved row (outreach-approval.ts), so a test that wants a send must hold one first — the
// same two steps the product takes (draft, then approve the revision that was read).
import type { PipelineEntry } from "../db/core";
import { outreachLetterDraft, type OutreachLetter } from "../db/outreach-letters";
import { approveOutreachLetter } from "../outreach-release";

export const TEST_APPROVER = "human:Eva Approver";

export function approvedOutreachFor(
  entry: PipelineEntry,
  draft: { subject?: string; body?: string; lang?: string; source?: string | null } = {}
): OutreachLetter {
  const { letter } = outreachLetterDraft(
    {
      entryId: entry.id,
      subject: draft.subject ?? "A role you'd be great for",
      body: draft.body ?? "We'd love to talk.",
      lang: draft.lang ?? "en",
      source: draft.source ?? null,
    },
    entry.workspaceId
  );
  const approved = approveOutreachLetter(letter.id, { revision: letter.revision, approvedBy: TEST_APPROVER }, entry.workspaceId);
  if (!approved) throw new Error(`test letter ${letter.id} could not be approved`);
  return approved;
}
