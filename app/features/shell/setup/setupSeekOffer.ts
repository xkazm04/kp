// Whether the first-run wizard may OFFER the job-seeker arm of its intent fork.
//
// The seeker module (/me) is off unless the install sets KP_JOBSEEKER=1
// (app/_lib/jobseeker/enabled.ts — the one place the env is read). With it off, the
// wizard must not offer "I'm looking for a job" and must never finish on /me: that
// would hand a recruiting team's first user a link to a page that 404s. So the
// fork's question disappears and the run is the hiring run it was before the fork
// existed — Welcome already answered `hire`, every step after it as it always was.
//
// The server knows the switch; the wizard is a client component. app/page.tsx reads
// jobseekerEnabled() and seeds SetupSeekOfferContext (SetupSeekOfferProvider.tsx), and
// the wizard reads the context. Its DEFAULT is false — a wizard mounted anywhere the
// seed does not reach offers the hiring run only, i.e. it fails closed.

import { createContext } from "react";
import { SETUP_INTENTS, type SetupIntent } from "./setupSteps";

export const SetupSeekOfferContext = createContext<boolean>(false);

/** The intents the fork offers on this install. */
export function offeredIntents(seekOffered: boolean): readonly SetupIntent[] {
  return seekOffered ? SETUP_INTENTS : SETUP_INTENTS.filter((i) => i !== "seek");
}

/** The intent a run starts with: unanswered while there is a real choice to make,
 *  already `hire` when hiring is the only arm this install offers. */
export function initialIntent(seekOffered: boolean): SetupIntent | null {
  return seekOffered ? null : "hire";
}

/** An intent coming from anywhere but the fork itself (a restored draft written while
 *  the module was on) folded onto what this install offers. */
export function offeredIntent(intent: SetupIntent | null, seekOffered: boolean): SetupIntent | null {
  return seekOffered ? intent : "hire";
}
