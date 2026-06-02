"use client";

import { Sparkles } from "lucide-react";
import { LoadStatus } from "@/app/_components/LoadStatus";
import type { LoadState } from "@/app/_lib/useLoader";
import { LifecycleRow } from "./LifecycleRow";
import type { Lifecycle } from "./DevTypes";

export function LifecycleSection({ lifecycles, approveLifecycle, state }: { lifecycles: Lifecycle[]; approveLifecycle: (id: string) => void; state: LoadState }) {
  // Empty + healthy renders nothing (LoadStatus banner is null); empty + failed
  // surfaces the outage instead of an indistinguishable blank.
  if (lifecycles.length === 0) return <LoadStatus state={state} label="lifecycles" />;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <Sparkles size={13} className="text-coral" /> Automated lifecycle <span className="text-coral">· {lifecycles.length}</span>
        <LoadStatus state={state} label="lifecycles" variant="pill" />
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
