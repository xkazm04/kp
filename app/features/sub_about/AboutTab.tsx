"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "../../_components/Markdown";
import { allCoverageItems, coverageGroups, GROUP_EARLY, type CoverageItem } from "./AboutCoverageData";
import { StudentsAbout } from "./StudentsAbout";

export function AboutTab() {
  const t = useTranslations("about");
  const [selected, setSelected] = useState<CoverageItem>(allCoverageItems[0]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
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
        <Link
          href="/diagrams"
          className="focus-ring mt-3 inline-flex items-center gap-1.5 text-base font-medium text-coral hover:underline"
        >
          {t("archLink")} <ArrowRight size={15} />
        </Link>
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
      </div>
    </section>
  );
}
