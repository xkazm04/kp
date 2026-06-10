"use client";

import { Sparkles } from "lucide-react";
import type { LoadState } from "@/app/_lib/useLoader";
import { DevSection } from "./DevShared";
import { LifecycleRow } from "./LifecycleRow";
import type { Lifecycle } from "./DevTypes";

export function LifecycleSection({
  lifecycles,
  approveLifecycle,
  state,
  onChanged,
}: {
  lifecycles: Lifecycle[];
  approveLifecycle: (id: string) => void;
  state: LoadState;
  /** W5-3 — refresh after a close-out flips a lifecycle to its terminal stage. */
  onChanged?: () => void;
}) {
  return (
    <DevSection icon={<Sparkles size={13} className="text-coral" />} title="Automated lifecycle" count={lifecycles.length} state={state} label="lifecycles">
      <p className="mt-1 text-micro text-steel">
        Each case advances under policy — auto-approving clean designs, routing flagged ones to you, publishing, and
        (as submissions arrive) evaluating → ranking → promoting the top candidates into Decisions. No manual steps between.
      </p>
      <div className="mt-3 space-y-2">
        {lifecycles.map((lc) => (
          <LifecycleRow key={lc.id} lc={lc} onApprove={() => approveLifecycle(lc.id)} onChanged={onChanged} />
        ))}
      </div>
    </DevSection>
  );
}
