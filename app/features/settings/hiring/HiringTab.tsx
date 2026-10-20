"use client";

// Settings → Hiring — the workspace's pipeline: its columns, the policy at each of them, and a
// preview of what that plan does to the Hiring tabs. Rendered from the composition kit
// (./kit/HiringKitView; the owner judged the port in the product at Gate 1 of the kit-unification
// spark and promoted it). This module is the tab's lazy chunk (shell/tabChunks.ts), so the view is
// imported statically here.
//
// PERSISTENCE, save-gated on purpose: edits accumulate as a local DRAFT and nothing is stored
// until Save - a stray click on a preset or a guard can never silently override the workspace's
// live policy, and an axis edit can never silently strand a candidate. Save writes the axis first,
// then the plan (the plan's stations resolve against the axis). State and IO live in
// useHiringComposer, the rules that read them in composerState.ts.
import HiringKitView from "./kit/HiringKitView";

export function HiringTab() {
  return <HiringKitView />;
}
