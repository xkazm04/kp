"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PlantUml } from "@/app/_components/puml/PlantUml";
import { STEP_DETAILS, type StepDetail, type StepStatus } from "./pipelineSteps";

const STATUS_META: Record<StepStatus, { label: string; cls: string }> = {
  live: { label: "Automated", cls: "bg-moss/15 text-moss" },
  gate: { label: "Human gate", cls: "bg-coral/10 text-coral" },
  gap: { label: "To build", cls: "bg-stone-100 text-steel" },
};

// The to-be funnel, made interactive. Clicking a step opens a half-page drawer
// on the right with that step's real implementation; the funnel stays on the
// left (the active step keeps a coral border) so the relation is visible.
export function PipelineExplorer({ source }: { source: string }) {
  const [active, setActive] = useState<{ id: string; detail: StepDetail } | null>(null);

  return (
    <>
      <p className="mt-2 text-meta text-steel">
        Click any step to see how it&apos;s wired — the open step stays outlined here on the left.
      </p>
      {/* When a step is open, the funnel shifts into the left half so both the
          funnel and the drawer are visible at once. */}
      <div className={`transition-[padding] duration-300 ${active ? "lg:pr-[52%]" : ""}`}>
        <PlantUml
          source={source}
          scale="natural"
          className="mt-3"
          expandable
          strict
          activeNodeId={active?.id}
          onNodeClick={(node) => {
            const detail = STEP_DETAILS[node.id];
            if (detail) {
              setActive({ id: node.id, detail });
            } else if (process.env.NODE_ENV !== "production") {
              // A clickable funnel node whose puml alias has no STEP_DETAILS entry
              // no-ops silently — surface the .puml<->pipelineSteps drift in dev.
              // The contract is CI-guarded by tests/test_pipeline_diagram_contract.py.
              console.warn(`[diagrams] no STEP_DETAILS entry for clicked node "${node.id}" — add one in app/diagrams/pipelineSteps.ts.`);
            }
          }}
        />
      </div>
      {active ? <StepDrawer detail={active.detail} onClose={() => setActive(null)} /> : null}
    </>
  );
}

function StepDrawer({ detail, onClose }: { detail: StepDetail; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = STATUS_META[detail.status];
  return (
    // pointer-events-none on the wrapper keeps the left half (the funnel)
    // clickable; the panel re-enables pointer events for itself.
    <div className="pointer-events-none fixed inset-0 z-50 flex justify-end">
      <aside
        role="dialog"
        aria-modal="false"
        aria-label={detail.title}
        className="animate-drawer-in pointer-events-auto relative flex h-full w-full flex-col overflow-y-auto border-l border-stone-200 bg-paper shadow-2xl lg:w-1/2"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-stone-200 bg-paper/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-meta ${s.cls}`}>{s.label}</span>
            <h2 className="mt-1 font-serif text-h2 text-ink">{detail.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-md p-1.5 text-steel hover:bg-stone-100"
          >
            <X size={20} />
          </button>
        </header>

        <div className="px-6 py-6">
          <p className="max-w-2xl text-body leading-7 text-steel">{detail.summary}</p>
          <PlantUml source={detail.puml} scale="natural" className="mt-5" strict />
          <div className="mt-5">
            <p className="text-meta uppercase text-steel">Code</p>
            <ul className="mt-1 space-y-0.5">
              {detail.files.map((f) => (
                <li key={f}>
                  <code className="text-sm text-ink">{f}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
