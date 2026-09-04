"use client";

import { useTranslations } from "next-intl";
import { CARD_PAD, PANEL } from "@/app/_components/ui/recipes";
import { LibrarySavedJdsLedger } from "./JdsSavedLedger";

// The JD library: a header + the saved-JD console (LibrarySavedJdsLedger), which
// carries both the "Saved" table and the "Generate" authoring panel behind its own
// section switcher. The prototype A/B strip and the Editorial / Spark / Current
// variants were consolidated away once Ledger won (see /prototype).
export function JdsTab() {
  const t = useTranslations("library.tab");

  return (
    // Tier 1 (docs/design/loading-choreography.md): header + the ledger cascade in as this
    // section's direct children. The ledger owns its own fetch (useJdLibrary lives
    // inside LibrarySavedJdsLedger), so aria-busy for the first load sits there,
    // right where that fetch does, rather than being threaded up through a prop.
    <section className={`stagger-children ${PANEL} ${CARD_PAD}`}>
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          {t.rich("intro", { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      <LibrarySavedJdsLedger />
    </section>
  );
}
