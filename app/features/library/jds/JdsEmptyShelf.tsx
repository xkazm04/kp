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
// have one. Two honest routes to a first sheet, both landing in the existing
// builder: write it yourself (Save as draft, no AI round-trip) or have the
// builder draft it.
//
// Differs from Variant B by looking at the ARTIFACT (what a spec is worth once
// shelved) rather than the MACHINE that produces it.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Copy, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { LIBRARY_GLYPH } from "@/app/_components/glyph/glyphs/libraryGlyph";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP, EYEBROW, META_LABEL, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

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
// live destination so the payoff is reachable, not just described.
const REUSE: { tab: WorkspaceTabId; icon: LucideIcon; label: string }[] = [
  { tab: "analyze", icon: Sparkles, label: "Score CVs against it" },
  { tab: "jobs", icon: ArrowRight, label: "Ingest it as an open role" },
  { tab: "library", icon: Copy, label: "Duplicate it for the next opening" },
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
          className="h-24 w-24 shrink-0 sm:h-28 sm:w-28"
        />
        <div>
          <p className={EYEBROW}>Empty shelf</p>
          <h3 className={`mt-1 ${TITLE_DISPLAY}`}>Nothing on the shelf yet</h3>
          <p className="mt-2 max-w-xl text-body text-steel">
            A job description written here becomes stock: every role you open, every CV you score, and every
            duplicate of the next opening starts from one of these sheets.
          </p>
        </div>
      </div>

      {/* The ghost record — the ledger's own columns, empty. Teaches the shape of
          a shelved spec using the same localized headers the real table uses. */}
      <div className={`${PANEL} mt-6 p-4`}>
        <p className={META_LABEL}>The record you&rsquo;re about to create</p>
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
          <PenLine size={15} aria-hidden /> Write the first spec
        </button>
        <button type="button" onClick={onStartGenerate} className={`${BTN_SECONDARY} h-10 px-4 text-base`}>
          <Sparkles size={15} aria-hidden /> Have the builder draft it
        </button>
        <p className="text-sm text-steel">
          Both open the Generate panel &mdash; save a draft as-is, or let the AI build the description, a market
          salary band and an interview case.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4">
        <span className={META_LABEL}>One sheet is reusable for</span>
        {REUSE.map((r) => (
          <Link
            key={r.label}
            href={buildTabSwitchUrl(r.tab, searchStr)}
            className={`${CHIP} hover:border-coral/40 hover:text-ink`}
          >
            <r.icon size={13} aria-hidden />
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
