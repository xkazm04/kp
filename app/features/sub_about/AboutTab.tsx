"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Markdown } from "../../_components/Markdown";
import { allCoverageItems, coverageGroups, type CoverageItem } from "./AboutCoverageData";

export function AboutTab() {
  const [selected, setSelected] = useState<CoverageItem>(allCoverageItems[0]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">About</p>
        <h2 className="mt-1 font-serif text-display text-ink">What the platform does</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          From the original CV-analysis acceptance criteria to the v2 matching platform and its HR
          automation. Pick a capability to read how it works, drawn as a live component diagram:{" "}
          <span className="font-medium text-moss">moss</span> is automated,{" "}
          <span className="font-medium text-coral">coral</span> is a deliberate human gate, and{" "}
          <span className="font-medium text-steel">dashed</span> arrows are optional or asynchronous
          steps.
        </p>
        <Link
          href="/diagrams"
          className="focus-ring mt-3 inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
        >
          See the full system architecture (v1 &amp; v2) <ArrowRight size={15} />
        </Link>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav
          aria-label="Platform capabilities"
          className="space-y-4 rounded-lg border border-stone-200 bg-paper p-2"
        >
          {coverageGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 pt-1 text-meta uppercase text-steel">{group.label}</p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = item.slug === selected.slug;
                  return (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        aria-pressed={active}
                        className={`focus-ring w-full rounded-md px-3 py-2 text-left text-base font-medium transition-colors ${
                          active ? "bg-white text-ink shadow-panel" : "text-ink hover:bg-white"
                        }`}
                      >
                        {item.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <article className="rounded-lg border border-stone-200 bg-white p-5">
          <p className="text-meta uppercase text-coral">Capability</p>
          <h3 className="mt-1 font-serif text-h2 text-ink">{selected.title}</h3>
          <p className="mt-2 text-base leading-7 text-steel">{selected.lead}</p>
          <Markdown content={selected.body} className="mt-4" />
        </article>
      </div>
    </section>
  );
}
