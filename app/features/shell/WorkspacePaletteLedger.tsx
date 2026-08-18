"use client";

/*
 * PROTOTYPE VARIANT B — "Ledger" (console / master–detail metaphor).
 *
 * A compact field, then TWO panes: the left is a dense grouped index (group
 * eyebrows with counts, tight glyph rows — a ledger you scan), the right is a live
 * PREVIEW of the highlighted entry: kind eyebrow, the name set in the display face,
 * its facts (archetype / job · stage / score), and exactly WHERE Enter will land
 * ("Opens in the Matrix tab", "the JD detail page") with an explicit Open button.
 * Differs from baseline and Spotlight by answering "what will I get if I press
 * Enter" BEFORE the navigation — the preview is the trust affordance — at the cost
 * of width (it needs the 3xl dialog, split half/half; below `sm` the preview collapses under the list).
 */
import { ArrowRight, Search } from "lucide-react";
import { BTN_PRIMARY, EYEBROW, KBD, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { destinationOf, groupMeta } from "./workspacePaletteMeta";
import { PalettePreviewPane } from "./palette/PalettePreviewPane";
import { PaletteRow } from "./WorkspacePaletteRow";
import { paletteItemId } from "./workspacePaletteResults";
import type { PaletteItem, PaletteViewProps } from "./workspaceCommandPaletteTypes";

export function WorkspacePaletteLedger({ inputRef, t, nav, items, active, query, listView, error, kbdHint, onQueryChange, onInputKey, go, setSelected }: PaletteViewProps) {
  const q = query.trim();
  const current = items[active] ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Field ── */}
      <div className="relative border-b border-stone-200 px-4 py-3">
        <Search size={16} className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
        <TextInput
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={current ? paletteItemId(active) : undefined}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={t("placeholder")}
          className="pl-9 pr-16"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd suppressHydrationWarning className={`${KBD} pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-[11px]`}>
          {kbdHint}
        </kbd>
      </div>
      {error ? <p className="px-4 pt-2 text-sm text-coral">{error}</p> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
        {/* ── Index (left) ── */}
        <ul
          id="palette-results"
          role="listbox"
          aria-label={t("title")}
          aria-busy={listView.showSearching || undefined}
          className={`min-h-0 space-y-px overflow-y-auto px-2 py-2 sm:border-r sm:border-stone-200 ${listView.dimItems ? "opacity-50 transition-opacity" : ""}`}
        >
          {items.map((item, i) => {
            const prev = i > 0 ? items[i - 1] : null;
            const groupStart = !prev || prev.group !== item.group;
            const sectionStart = !!item.section && (groupStart || prev?.section !== item.section);
            const groupSize = groupStart ? items.filter((it) => it.group === item.group).length : 0;
            return (
              <li key={item.key}>
                {groupStart ? (
                  <p className={`flex items-baseline justify-between px-2 pb-1 text-meta uppercase text-steel ${i === 0 ? "pt-1" : "pt-3"}`}>
                    <span>{t(`groups.${item.group}` as Parameters<typeof t>[0])}</span>
                    <span className="nums text-steel/70">{groupSize}</span>
                  </p>
                ) : null}
                {sectionStart ? <p className={`px-2 pb-0.5 text-sm font-semibold text-steel/80 ${groupStart ? "" : "pt-2"}`}>{item.section}</p> : null}
                <PaletteRow item={item} index={i} isActive={i === active} query={query} go={go} setSelected={setSelected} dense />
              </li>
            );
          })}
          {listView.showSearching && items.length === 0 ? (
            <li className="px-2 py-4 text-sm text-steel" aria-live="polite">
              {t("searching")}
            </li>
          ) : null}
          {listView.placeholder === "no-results" ? <li className="px-2 py-4 text-sm text-steel">{t("noResults", { q })}</li> : null}
          {listView.placeholder === "empty" && items.length === 0 ? <li className="px-2 py-4 text-sm text-steel">{t("empty")}</li> : null}
        </ul>

        {/* ── Preview (right) ── */}
        <div className="min-h-0 overflow-y-auto border-t border-stone-200 p-4 sm:border-t-0">
          {current ? <PreviewCard item={current} t={t} nav={nav} go={go} /> : <p className="text-sm text-steel">{t("previewPick")}</p>}
          {!q ? <p className="mt-4 text-sm text-steel">{t("empty")}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Where Enter lands, in words — the preview's key line. */
function whereText(item: PaletteItem, t: PaletteViewProps["t"], nav: PaletteViewProps["nav"]): string | null {
  const kind = item.recent?.type ?? item.group;
  const dest = destinationOf({ ...item, group: kind });
  if (dest && "tab" in dest) {
    const tabKey = `tabs.${dest.tab}` as Parameters<typeof nav>[0];
    return t("previewOpensIn", { where: t("whereTab", { tab: nav.has(tabKey) ? nav(tabKey) : dest.tab }) });
  }
  if (dest && "page" in dest) return t("previewOpensIn", { where: dest.page === "jd" ? t("whereJd") : t("whereAnalysis") });
  if (item.group === "tabs") return t("previewOpensIn", { where: t("whereTab", { tab: item.label }) });
  return null;
}

function PreviewCard({ item, t, nav, go }: { item: PaletteItem; t: PaletteViewProps["t"]; nav: PaletteViewProps["nav"]; go: PaletteViewProps["go"] }) {
  const kind = item.recent?.type ?? item.group;
  const { icon: Icon, tint } = groupMeta(kind);
  const where = whereText(item, t, nav);
  return (
    <div className={`${PANEL_SUNKEN} flex h-full flex-col gap-3 p-4`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tint} dark:-rotate-2`} aria-hidden>
          <Icon size={16} />
        </span>
        <p className={EYEBROW}>{item.section ?? t(`groups.${kind}` as Parameters<typeof t>[0])}</p>
      </div>
      <h3 className="font-serif text-h3 leading-tight text-ink">{item.label}</h3>
      {/* The live facts for this destination / entity (app/features/shell/palette). */}
      <PalettePreviewPane item={item} />
      <div className="mt-auto space-y-2 pt-2">
        {where ? <p className="text-sm text-steel">{where}</p> : null}
        <button type="button" onClick={() => go(item)} className={`${BTN_PRIMARY} h-9 px-3 text-sm capitalize`}>
          {t("hintOpen")}
          <ArrowRight size={14} aria-hidden />
          <kbd className="ml-1 rounded border border-white/40 px-1 text-[11px] font-semibold">↵</kbd>
        </button>
      </div>
    </div>
  );
}
