"use client";

import { JdBuilder } from "./JdBuilder";
import type { GeneratePrefill } from "./jd-library";

// The "Generate" half of the two-tab library. The manual copy-paste form was
// folded into the builder: its "Describe the need" body is now a rich editor, and
// "Save as draft" there persists that input straight to the library without the AI
// round-trip — so there's no longer a separate paste surface. `prefill` seeds the
// builder when the user Duplicates a saved role (the Ledger switches here and passes
// the source role's known fields).
export function LibraryGeneratePanel({ onSaved, prefill }: { onSaved: () => void; prefill?: GeneratePrefill | null }) {
  return <JdBuilder onSaved={onSaved} prefill={prefill ?? undefined} />;
}
