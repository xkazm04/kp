// The attachment half of the Analyze draft layer (challenge-r02 analyze-engine/B;
// the layer table is in analyzeSession.ts). The Workspace unmounts the Analyze tab on
// every switch, and File objects cannot be serialized — so the CV variants, the JD
// file and the company file are held HERE, in module memory, for the life of the page.
//
// Never in browser storage: a CV is candidate PII, and sessionStorage would keep its
// bytes on disk past the tab. This module therefore has no serializer and touches no
// storage API (analyzeAttachmentStore.test.ts pins both). Invalidation: reset() clears
// it, and a reload ends it.

export type AnalyzeAttachments = {
  cvFiles: readonly File[];
  jobDescriptionFile: File | null;
  companyFile: File | null;
};

const EMPTY: AnalyzeAttachments = { cvFiles: [], jobDescriptionFile: null, companyFile: null };

let held: AnalyzeAttachments = EMPTY;

// A module on the server is shared by every request; it must never hold a CV.
const inBrowser = () => typeof window !== "undefined";

/** Replace the held set with the form's current attachments. */
export function putAnalyzeAttachments(next: AnalyzeAttachments): void {
  if (!inBrowser()) return;
  held = { cvFiles: [...next.cvFiles], jobDescriptionFile: next.jobDescriptionFile, companyFile: next.companyFile };
}

/**
 * A detached snapshot of the held set. Reading does not drain it: React may run an
 * initializer twice, and both mounts must see the same files.
 */
export function takeAnalyzeAttachments(): AnalyzeAttachments {
  if (!inBrowser()) return { ...EMPTY, cvFiles: [] };
  return { cvFiles: [...held.cvFiles], jobDescriptionFile: held.jobDescriptionFile, companyFile: held.companyFile };
}

/** Drop every held file (reset). */
export function clearAnalyzeAttachments(): void {
  held = EMPTY;
}
