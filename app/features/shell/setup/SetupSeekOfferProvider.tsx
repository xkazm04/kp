"use client";

import type { ReactNode } from "react";
import { SetupSeekOfferContext } from "./setupSeekOffer";

// The client half of the seek-offer seed (setupSeekOffer.ts): app/page.tsx is a server
// component and cannot render a context provider itself.
export function SetupSeekOfferProvider({ offered, children }: { offered: boolean; children: ReactNode }) {
  return <SetupSeekOfferContext.Provider value={offered}>{children}</SetupSeekOfferContext.Provider>;
}
