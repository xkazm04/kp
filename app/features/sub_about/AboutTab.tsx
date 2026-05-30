"use client";

import { useState } from "react";
import Image from "next/image";
import { sortedCoverageItems, type CoverageItem } from "./AboutCoverageData";

export function AboutTab() {
  const [selected, setSelected] = useState<CoverageItem>(sortedCoverageItems[0]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">About</p>
        <h2 className="mt-1 font-serif text-display text-ink">Acceptance coverage</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          The 11 capabilities the pipeline ships. Pick one on the left to see its illustration and
          the supporting notes on the right.
        </p>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav
          aria-label="Acceptance coverage items"
          className="rounded-lg border border-stone-200 bg-paper p-2"
        >
          <ul className="space-y-1">
            {sortedCoverageItems.map((item) => {
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
        </nav>

        <article className="space-y-5">
          <figure className="overflow-hidden rounded-lg border border-stone-200 bg-paper">
            <Image
              key={selected.slug}
              src={`/coverage/${selected.slug}.png`}
              alt={selected.title}
              width={1024}
              height={640}
              className="block h-auto w-full"
              priority
            />
          </figure>
          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <p className="text-meta uppercase text-coral">Capability</p>
            <h3 className="mt-1 font-serif text-h2 text-ink">{selected.title}</h3>
            <p className="mt-3 text-base leading-6 text-ink">{selected.summary}</p>
            <ul className="mt-4 space-y-3">
              {selected.details.map((detail) => (
                <li key={detail} className="rounded-md bg-paper p-3 text-base leading-6 text-ink">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}
