"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { CoverageItem } from "./AboutCoverageData";
import { AboutStudentsExampleScoring } from "./AboutStudentsExampleScoring";
import { AboutStudentsInterviewScript } from "./AboutStudentsInterviewScript";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): same PlantUML-chain split as AboutTab —
// the Overview tab's Markdown is the only tab that can render a `puml` fence, so
// it gets its own chunk instead of pulling the diagram engine into every tab.
const Markdown = dynamic(() => import("../../../_components/Markdown").then((m) => ({ default: m.Markdown })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

// Dedicated About page for the early-career thesis: the selected card's diagram +
// description stay the default tab; two more tabs make the mechanic tangible — a
// worked example of students scored side by side (Decisions-style comparison) and
// the high-level interview script that extracts those signals. Everything here is
// ILLUSTRATIVE (synthetic candidates); the real tables live in Decisions.
//
// Split into AboutStudentsExampleScoring.tsx, AboutStudentsInterviewScript.tsx and
// aboutStudentsData.ts (the synthetic candidate data) to keep this file under the
// 200-line cap.

const TABS = ["Overview", "Example scoring", "Interview script"] as const;
type Tab = (typeof TABS)[number];

export function StudentsAbout({ item }: { item: CoverageItem }) {
  const t = useTranslations("about.students");
  const [tab, setTab] = useState<Tab>("Overview");
  const tabLabel: Record<Tab, string> = {
    Overview: t("tabOverview"),
    "Example scoring": t("tabExample"),
    "Interview script": t("tabScript"),
  };
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-5">
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h3 className="mt-1 font-serif text-h2 text-ink">{item.title}</h3>
      <p className="mt-2 text-base leading-7 text-steel">{item.lead}</p>

      <div role="tablist" aria-label={t("viewsAria")} className="mt-4 flex gap-1 rounded-lg border border-stone-200 bg-paper p-1">
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={`focus-ring flex-1 rounded-md px-3 py-1.5 text-base font-medium transition-colors ${
              tab === tb ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
            }`}
          >
            {tabLabel[tb]}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "Overview" ? (
          <Markdown content={item.body} />
        ) : tab === "Example scoring" ? (
          <AboutStudentsExampleScoring />
        ) : (
          <AboutStudentsInterviewScript />
        )}
      </div>
    </article>
  );
}
