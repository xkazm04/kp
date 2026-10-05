"use client";

import { ChannelsNightShell } from "./night/ChannelsNightShell";

/*
 * Hiring > Channels is "The Night Post" (the channels-setup contest winner): the plumbing as a
 * district you walk into, level by level (night/README.md). It replaced the composition-kit view
 * and the setup cards that view mounted; every behaviour they had lives on a level now
 * (the parity table is linked from night/README.md).
 *
 * A static import, not next/dynamic: this module IS the tab's lazy chunk (shell/tabChunks.ts), so a
 * second dynamic boundary would only add a chunk round-trip and a loading placeholder between the
 * tab click and the first frame.
 */
export function ChannelsTab() {
  return <ChannelsNightShell />;
}
