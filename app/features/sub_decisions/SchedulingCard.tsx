"use client";

import { useState } from "react";
import { Calendar, Check, X } from "lucide-react";
import { CandidateHead } from "./DecisionsShared";
import { DAYS, TIMES, type Entry } from "./DecisionsTypes";

export function SchedulingCard({
  entry,
  onApprove,
  onDecline,
}: {
  entry: Entry;
  onApprove: (slot: string) => void;
  onDecline: () => void;
}) {
  const proposed = entry.approvalDetail || "Tue 14:00";
  const [pick, setPick] = useState(proposed);
  const [pickDay, pickTime] = pick.split(" ");

  return (
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <CandidateHead entry={entry} />
      <div className="mt-2 flex items-center gap-1.5 text-sm text-ink">
        <Calendar size={14} className="text-steel" />
        Proposed: <span className="font-semibold">{proposed}</span>
        {pick !== proposed ? <span className="text-steel">· you picked {pick}</span> : null}
      </div>

      {/* week × time grid visualization */}
      <div className="mt-2 overflow-hidden rounded-md border border-stone-200">
        <div className="grid grid-cols-[44px_repeat(5,1fr)] bg-paper text-center text-sm text-steel">
          <div className="py-1" />
          {DAYS.map((d) => (
            <div key={d} className="py-1 font-semibold">
              {d}
            </div>
          ))}
        </div>
        {TIMES.map((t) => (
          <div key={t} className="grid grid-cols-[44px_repeat(5,1fr)] border-t border-stone-100">
            <div className="py-1 pl-1 text-sm text-steel">{t}</div>
            {DAYS.map((d) => {
              const slot = `${d} ${t}`;
              const isProposed = slot === proposed;
              const isPicked = slot === pick;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPick(slot)}
                  aria-label={`Pick ${slot}`}
                  className={`m-0.5 h-6 rounded transition-colors ${
                    isPicked
                      ? "bg-moss text-white"
                      : isProposed
                        ? "bg-moss/20 ring-1 ring-moss/40"
                        : "bg-stone-50 hover:bg-coral/10"
                  }`}
                >
                  {isPicked ? <Check size={12} className="mx-auto" /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onApprove(pick)}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-base font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> Confirm {pickDay} {pickTime}
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} />
        </button>
      </div>
    </article>
  );
}
