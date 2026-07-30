"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Defer } from "@/app/_components/ui/Defer";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { allCoverageItems, coverageGroups, GROUP_EARLY, type CoverageItem } from "./AboutCoverageData";

// Tier 3 (docs/design/loading-choreography.md): Markdown pulls in the PlantUML
// diagram chain (parse/layout/measure — ~600 lines of layout code) to render
// every capability's `puml` fence. That chain gets its own chunk so the tab's
// entry payload is the header + nav, not a diagram engine nobody asked for yet.
const Markdown = dynamic(() => import("../../../_components/Markdown").then((m) => ({ default: m.Markdown })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});
const StudentsAbout = dynamic(() => import("./AboutStudents").then((m) => ({ default: m.StudentsAbout })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

export function AboutTab() {
  const t = useTranslations("about");
  const [selected, setSelected] = useState<CoverageItem>(allCoverageItems[0]);
  // 5d2e0998 — the guided tour's persistent home: About explains the product,
  // the simulation SHOWS it (Design → Source → Screen → Interview → Offer →
  // Hired, live, across the real tabs).
  const sim = useSimulation();

  return (
    // Tier 1: no fetch here (About is fully static) — the cascade is purely
    // about not building the whole page in one frame. Header + the nav/content
    // grid are this section's only direct children, so they're what stagger in.
    <section className="stagger-children rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", {
            moss: (chunks) => <span className="font-medium text-moss">{chunks}</span>,
            coral: (chunks) => <span className="font-medium text-coral">{chunks}</span>,
            dashed: (chunks) => <span className="font-medium text-steel">{chunks}</span>,
          })}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Link
            href="/diagrams"
            className="focus-ring inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
          >
            {t("archLink")} <ArrowRight size={15} />
          </Link>
          {!sim.running ? (
            <button
              type="button"
              onClick={sim.start}
              title={t("tourTitle")}
              className="focus-ring inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
            >
              <Play size={15} aria-hidden /> {t("tourLink")}
            </button>
          ) : null}
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav
          aria-label={t("capabilitiesNav")}
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

        {/* Tier 3: the selected panel carries the PlantUML-rendering Markdown —
            on the stacked (< lg) layout it sits below the nav, genuinely below
            the fold, so it mounts on scroll-into-view rather than on entry. The
            reserved-height placeholder keeps the grid from jumping. */}
        <Defer strategy="visible" placeholder={<div className="reveal-quiet min-h-[26rem]" aria-hidden />}>
          {selected.group === GROUP_EARLY ? (
            // The early-career thesis gets a dedicated tabbed page: the card's
            // diagram + description stay the default view, with a worked scoring
            // example and the interview thought-script as sibling tabs.
            <StudentsAbout item={selected} />
          ) : (
            <article className="rounded-lg border border-stone-200 bg-white p-5">
              <p className="text-meta uppercase text-coral">{t("capability")}</p>
              <h3 className="mt-1 font-serif text-h2 text-ink">{selected.title}</h3>
              <p className="mt-2 text-base leading-7 text-steel">{selected.lead}</p>
              <Markdown content={selected.body} className="mt-4" />
            </article>
          )}
        </Defer>
      </div>
    </section>
  );
}
