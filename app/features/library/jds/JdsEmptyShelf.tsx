"use client";

// Variant A — "the shelf you stock".
//
// Metaphor: the JD library is an ASSET SHELF, not a list. A job description here
// isn't a one-off document you type and throw away — it's stock: written once,
// then duplicated into the next opening, measured against every CV, and ingested
// as a job. So the empty state sells the shelf rather than apologising for the
// hole. Its centrepiece is a GHOST RECORD — the real ledger columns (Role · Field
// · Seniority · Status · Analyzed · Saved) rendered as empty slots — so the
// recruiter learns the shape of the thing they're about to shelve before they
// have one. ONE route to a first
// sheet. There were two buttons here - "Write the first spec" and "Have the builder
// draft it" - running the identical onStartGenerate handler and landing on the
// identical panel; the note underneath even admitted it ("Both open the Generate
// panel"). Two controls that cannot be told apart by their outcome are a choice the
// reader has to make and cannot get right, so the shelf offers the one action it
// actually performs and the note names the two routes waiting on the other side
// (Save as draft, or the AI checklist) - which is where the choice really is.
//
// Differs from Variant B by looking at the ARTIFACT (what a spec is worth once
// shelved) rather than the MACHINE that produces it.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Copy, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE, GLYPH_SIZE_SM } from "@/app/_components/glyph/glyphSizes";
import { LIBRARY_GLYPH } from "@/app/_components/glyph/glyphs/libraryGlyph";
import { BTN_PRIMARY, CHIP, EYEBROW, META_LABEL, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

// One empty slot of the ghost record. `wide` gives the Role cell the span it has
// in the real table, so the phantom row reads with the ledger's own proportions.
function GhostCell({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className={META_LABEL}>{label}</p>
      <div className="mt-1.5 h-2.5 rounded-full border border-dashed border-stone-300 bg-stone-50" aria-hidden />
    </div>
  );
}

// What one shelved spec is reusable FOR — the real downstream affordances, each a
// live destination so the payoff is reachable, not just described. The label is a
// catalog key, resolved at render so the row localizes with the rest of the tab.
const REUSE: { tab: WorkspaceTabId; icon: LucideIcon; labelKey: "shelfReuseAnalyze" | "shelfReuseIngest" | "shelfReuseDuplicate" }[] = [
  { tab: "analyze", icon: Sparkles, labelKey: "shelfReuseAnalyze" },
  { tab: "jobs", icon: ArrowRight, labelKey: "shelfReuseIngest" },
  { tab: "library", icon: Copy, labelKey: "shelfReuseDuplicate" },
];

export function LibraryEmptyShelf({ onStartGenerate }: { onStartGenerate: () => void }) {
  const t = useTranslations("library.tab");
  const search = useSearchParams();
  const searchStr = search.toString();

  return (
    <div className="p-6">
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <MotionizedGlyph
          data={LIBRARY_GLYPH.data}
          viewBox={LIBRARY_GLYPH.viewBox}
          className={`${GLYPH_SIZE.md} shrink-0 ${GLYPH_SIZE_SM.lg}`}
        />
        <div>
          <p className={EYEBROW}>{t("shelfEyebrow")}</p>
          <h3 className={`mt-1 ${TITLE_DISPLAY}`}>{t("shelfTitle")}</h3>
          <p className="mt-2 max-w-xl text-body text-steel">{t("shelfBody")}</p>
        </div>
      </div>

      {/* The ghost record — the ledger's own columns, empty. Teaches the shape of
          a shelved spec using the same localized headers the real table uses. */}
      <div className={`${PANEL} mt-6 p-4`}>
        <p className={META_LABEL}>{t("shelfRecordLabel")}</p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-7">
          <GhostCell label={t("colRole")} wide />
          <GhostCell label={t("colField")} />
          <GhostCell label={t("colSeniority")} />
          <GhostCell label={t("colStatus")} />
          <GhostCell label={t("colAnalyzed")} />
          <GhostCell label={t("colSaved")} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onStartGenerate} className={`${BTN_PRIMARY} h-10 px-4 text-base`}>
          <PenLine size={15} aria-hidden /> {t("shelfWriteCta")}
        </button>
        <p className="max-w-xl text-sm text-steel">{t("shelfCtaNote")}</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
        <span className={META_LABEL}>{t("shelfReuseLabel")}</span>
        {REUSE.map((r) => (
          <Link
            key={r.labelKey}
            href={buildTabSwitchUrl(r.tab, searchStr)}
            className={`${CHIP} hover:border-coral/40 hover:text-ink`}
          >
            <r.icon size={13} aria-hidden />
            {t(r.labelKey)}
          </Link>
        ))}
      </div>
    </div>
  );
}
