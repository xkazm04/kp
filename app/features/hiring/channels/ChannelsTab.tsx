"use client";

import ChannelsKitView from "./kit/ChannelsKitView";

/*
 * Hiring > Channels is the composition-kit surface (kit-unification spark, Gate K2: the owner judged
 * the port in-product and promoted it). The "Intake Studio" view and its `?kit=1` switch are gone.
 *
 * A static import, not next/dynamic: this module IS the tab's lazy chunk (shell/tabChunks.ts), so a
 * second dynamic boundary would only add a chunk round-trip and a loading placeholder between the
 * tab click and the first frame.
 */
export function ChannelsTab() {
  return <ChannelsKitView />;
}
