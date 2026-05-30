"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { AiReviewCard } from "./AiReviewCard";
import { Empty } from "./DecisionsShared";
import { KeyDecisionCard } from "./KeyDecisionCard";
import { SchedulingCard } from "./SchedulingCard";
import type { Entry } from "./DecisionsTypes";

export function DecisionsTab() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Record<string, "accept" | "reject" | "approve_event">>({});

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  useEffect(() => {
    load();
  }, []);

  // Resolving cards stay in the list (not filtered out) so they can animate out
  // before setEntries removes them after the 260ms exit window.
  const pending = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
  const keyDecisions = pending.filter((e) => e.approvalKind === "decision");
  const scheduling = pending.filter((e) => e.approvalKind === "calendar");
  const aiReviews = pending.filter(
    (e) => e.approvalKind === "screening_review" || e.approvalKind === "scorecard_review" || e.approvalKind === "offer_review"
  );

  // While a card resolves, keep it mounted and fade+slide it out before removal.
  const leavingWrapClass = (e: Entry) =>
    resolving[e.id]
      ? "transition-all duration-200 ease-in pointer-events-none -translate-x-2 scale-[0.98] opacity-0"
      : "transition-all duration-200 ease-in";

  const act = async (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string) => {
    setResolving((s) => ({ ...s, [e.id]: action })); // triggers exit animation + removes from lists
    // remove from local state after the card animates out
    window.setTimeout(() => {
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
    }, 260);
    try {
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, detail }),
      });
      if (!r.ok) throw new Error();
    } catch {
      load(); // resync on failure
      setResolving((s) => {
        const n = { ...s };
        delete n[e.id];
        return n;
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">Decisions</p>
          <h2 className="mt-1 font-serif text-display text-ink">Your decision queue</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            The human-in-the-loop step. Key decisions advance or reject a candidate with full context; scheduling
            decisions confirm a proposed interview slot. Everything you action here moves the candidate in the{" "}
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "pipeline" }))}
              className="focus-ring font-semibold text-coral hover:underline"
            >
              pipeline
            </button>
            .
          </p>
        </div>
        <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-xs text-steel">
          {pending.length} pending
        </span>
      </header>

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : entries == null ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-6 text-center">
          <Check className="mx-auto text-moss" size={28} />
          <p className="mt-2 text-sm font-semibold text-ink">You&apos;re all caught up.</p>
          <p className="text-xs text-steel">No decisions are waiting on you right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {aiReviews.length > 0 ? (
            <section>
              <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <Sparkles size={13} className="text-coral" /> AI recommendations <span className="text-coral">· {aiReviews.length}</span>
              </h3>
              <p className="mt-1 text-[11px] text-steel">
                The LLM screened these at the AI-matched gate or synthesized an interview scorecard. Confirm or override —
                early-career candidates are deliberately held here for your judgment.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {aiReviews.map((e) => (
                  <div key={e.id} className={leavingWrapClass(e)}>
                    <AiReviewCard entry={e} onAccept={() => act(e, "accept")} onReject={() => act(e, "reject")} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h3 className="text-meta uppercase tracking-wide text-steel">
                Key decisions <span className="text-coral">· {keyDecisions.length}</span>
              </h3>
              <p className="mt-1 text-[11px] text-steel">Advance to the next stage, or reject — read the fit first.</p>
              <div className="mt-3 space-y-3">
                {keyDecisions.map((e) => (
                  <div key={e.id} className={leavingWrapClass(e)}>
                    <KeyDecisionCard entry={e} onAccept={() => act(e, "accept")} onReject={() => act(e, "reject")} />
                  </div>
                ))}
                {keyDecisions.length === 0 ? <Empty>No key decisions pending.</Empty> : null}
              </div>
            </section>

            <section>
              <h3 className="text-meta uppercase tracking-wide text-steel">
                Interview scheduling <span className="text-coral">· {scheduling.length}</span>
              </h3>
              <p className="mt-1 text-[11px] text-steel">Confirm the proposed slot, or pick another, then approve.</p>
              <div className="mt-3 space-y-3">
                {scheduling.map((e) => (
                  <div key={e.id} className={leavingWrapClass(e)}>
                    <SchedulingCard
                      entry={e}
                      onApprove={(slot) => act(e, "approve_event", slot)}
                      onDecline={() => act(e, "reject")}
                    />
                  </div>
                ))}
                {scheduling.length === 0 ? <Empty>No scheduling decisions pending.</Empty> : null}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
