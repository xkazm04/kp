"use client";

import { Sparkles } from "lucide-react";
import { LifecycleRow } from "./LifecycleRow";
import type { Lifecycle } from "./DevTypes";

export function LifecycleSection({ lifecycles, approveLifecycle }: { lifecycles: Lifecycle[]; approveLifecycle: (id: string) => void }) {
  if (lifecycles.length === 0) return null;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Sparkles size={13} className="text-coral" /> Automated lifecycle <span className="text-coral">· {lifecycles.length}</span>
      </h3>
      <p className="mt-1 text-micro text-steel">
        Each case advances under policy — auto-approving clean designs, routing flagged ones to you, publishing, and
        (as submissions arrive) evaluating → ranking → promoting the top candidates into Decisions. No manual steps between.
      </p>
      <div className="mt-3 space-y-2">
        {lifecycles.map((lc) => (
          <LifecycleRow key={lc.id} lc={lc} onApprove={() => approveLifecycle(lc.id)} />
        ))}
      </div>
    </section>
  );
}
