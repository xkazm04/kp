"use client";

import { useState } from "react";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { JdBuild } from "./JdBuild";
import { JdGrounding } from "./JdGrounding";
import { JdIntake } from "./JdIntake";

/*
 * PROTOTYPE SCAFFOLD — throwaway.
 *
 * Three directional takes on chapter 1 behind a switcher, so they can be
 * compared in place rather than described. Each argues a different thing about
 * the same mechanism:
 *
 *   Build     — control and concurrency. You choose what runs; unticked work
 *               never spawns; two chains go side by side; code assembles the
 *               document.
 *   Grounding — trust. Every requirement keeps a thread back to the input that
 *               justifies it, and the one that cannot trace is dropped unprinted.
 *   Intake    — origin. The need is captured as a conversation, and every field
 *               is stamped stated / inferred / default so the brief is auditable.
 *
 * When a direction wins, this file and the two losers are deleted and the
 * winner is rendered directly by the chapter. Nothing outside this folder knows
 * the switcher exists.
 */

type Variant = "build" | "grounding" | "intake";

const OPTIONS = [
  { value: "build" as const, label: "A · Build" },
  { value: "grounding" as const, label: "B · Grounding" },
  { value: "intake" as const, label: "C · Intake" },
];

const BLURB: Record<Variant, string> = {
  build: "Control and concurrency — what you ticked is what runs.",
  grounding: "Trust — every requirement traced, or dropped.",
  intake: "Origin — a conversation, stamped for provenance.",
};

export function JdScene() {
  const [variant, setVariant] = useState<Variant>("build");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedControl
          label="Chapter 1 direction"
          options={OPTIONS}
          value={variant}
          onChange={(v) => setVariant(v)}
        />
        <p className="text-meta text-steel">{BLURB[variant]}</p>
      </div>

      {variant === "build" ? <JdBuild /> : null}
      {variant === "grounding" ? <JdGrounding /> : null}
      {variant === "intake" ? <JdIntake /> : null}
    </div>
  );
}
