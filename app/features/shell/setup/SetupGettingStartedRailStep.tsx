"use client";

// One mark on the Getting-started "next move" ordered rail, split out of
// SetupGettingStartedNextMove.tsx so it stays under the 200-line file cap. Its
// state is read straight off the payload — verbatim markup, just relocated.
import { Check } from "lucide-react";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { Step, StepKey } from "./setupGettingStartedModel";

export function SetupGettingStartedRailStep({
  step,
  index,
  done,
  pending,
  active,
  label,
  optional,
  onSelect,
}: {
  step: Step;
  index: number;
  done: boolean;
  pending: boolean;
  active: boolean;
  label: string;
  optional: boolean;
  onSelect: (key: StepKey) => void;
}) {
  const marker = done
    ? "border-moss bg-moss/15 text-moss"
    : pending
      ? "border-amber-700 bg-amber-100 text-amber-700"
      : active
        ? "border-coral bg-coral/10 text-coral"
        : "border-stone-200 bg-white text-steel";

  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(step.key)}
        className={`focus-ring group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-paper ${
          active ? "bg-paper" : ""
        }`}
      >
        <span
          aria-hidden
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-sm font-semibold nums ${marker}`}
        >
          {done ? <Check size={13} /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${
              active ? "font-semibold text-ink" : done ? "text-steel" : "font-medium text-ink"
            }`}
          >
            {label}
          </span>
          {optional ? <span className={`block ${META_LABEL}`}>Optional</span> : null}
        </span>
      </button>
    </li>
  );
}
