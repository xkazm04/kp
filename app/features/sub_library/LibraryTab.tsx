"use client";

import { useTranslations } from "next-intl";
import { LibrarySavedJdsLedger } from "./LibrarySavedJdsLedger";

// The JD library: a header + the saved-JD console (LibrarySavedJdsLedger), which
// carries both the "Saved" table and the "Generate" authoring panel behind its own
// section switcher. The prototype A/B strip and the Editorial / Spark / Current
// variants were consolidated away once Ledger won (see /prototype).
export function LibraryTab() {
  const t = useTranslations("library.tab");

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
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
