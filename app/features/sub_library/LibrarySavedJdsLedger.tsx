"use client";

// The library's saved-JD surface: a dense operations console. The saved JDs are a
// ruled table whose metadata reads as real columns (Field · Seniority · Status ·
// Analyzed · Saved), with the filter controls pushed onto the column headers
// themselves — a search affordance on "Role" and enum dropdowns on Field /
// Seniority / Status — rather than a separate toolbar. The detail modal is a split
// record: a metadata rail on the left, the rendered posting on the right. The
// register is calm and data-forward (the Studio Light contract): nothing tilts,
// nothing floats.
//
// All user-facing copy threads next-intl `t()` (the `library.tab` namespace) — the
// column headers, filter menus, action tooltips, and detail-modal panels included —
// so cs/de/fr recruiters get a fully localized surface; the eslint
// i18next/no-literal-string gate is ON for this file (no blanket disable).
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #3)

import Link from "next/link";
import { forwardRef, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  type LucideIcon,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Badge } from "@/app/_components/Badge";
import { Markdown } from "@/app/_components/Markdown";
import { Skeleton } from "@/app/_components/Skeleton";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { formatSalaryRange, labelize } from "@/app/_lib/format";
import { normalizeMarketSalary } from "@/app/_lib/salary-band";
import { safeHttpLinks } from "@/app/_lib/safe-url";
import { dedupeBy } from "@/app/_lib/dedupe";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useIngestJob, useJdDetail, useJdLibrary } from "./jd-hooks";
import {
  facetCounts,
  filterAndSortJds,
  isUnlinked,
  jdStatusChip,
  seniorityMeta,
  shortDate,
  STATUS_FILTERS,
  statusCounts,
  type GeneratePrefill,
  type JdRow,
  type StatusFilter,
} from "./jd-library";
import { JdCandidateList } from "./JdCandidateList";
import { LibraryGeneratePanel } from "./LibraryGeneratePanel";
import { switchTab, duplicateToBuilder, nextMenuIndex, type LedgerNavState } from "./ledger-nav";

const ICON_BTN =
  "focus-ring inline-grid h-8 w-8 place-items-center rounded-md text-steel transition-colors hover:bg-paper hover:text-coral disabled:opacity-40";

// The table has seven columns; kept in one place so the "no match" row spans them.
const COLS = 7;

type FilterOption = { value: string; label: string; count?: number; icon?: LucideIcon };

export function LibrarySavedJdsLedger() {
  const t = useTranslations("library.tab");
  const enumLabel = useEnumLabel();
  const { rows, error, reload, refresh } = useJdLibrary();
  // Poll while any JD is mid-build: the analyzing→ready flip happens server-side
  // (the detached jd_build handler), so there's no client event to react to — a
  // silent in-place refresh picks it up without flickering the table. The interval
  // clears itself once the last analyzing row settles.
  const hasAnalyzing = useMemo(() => (rows ?? []).some((r) => r.analysis_status === "analyzing"), [rows]);
  useEffect(() => {
    if (!hasAnalyzing) return;
    const id = setInterval(refresh, 3500);
    return () => clearInterval(id);
  }, [hasAnalyzing, refresh]);
  // #2 — both sub-panels stay mounted; `nav.tab` toggles which is visible and
  // `nav.builderKey` is the builder's React key. A manual tab switch keeps the key
  // (draft preserved), Duplicate advances it (remount → re-reads prefill).
  // bug-ui-scan-2026-07-09 (jd-authoring-library-templates #2)
  const [nav, setNav] = useState<LedgerNavState>({ tab: "saved", builderKey: 0 });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [field, setField] = useState<string | null>(null);
  const [seniority, setSeniority] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<JdRow | null>(null);
  const [ingested, setIngested] = useState<{ slug: string; jobId: string | null } | null>(null);
  const [prefill, setPrefill] = useState<GeneratePrefill | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  // Duplicate: seed the Generate form with the source role's known fields (title,
  // company, seniority, field) AND, as the "Describe the need" starting content,
  // the recruiter's ORIGINAL prompt when the JD carries one (Generated roles now
  // persist it) — so regeneration designs from the intent, not the rendered
  // markdown. Legacy rows (draft saves / pre-migration builds) fall back to the
  // full body, then the truncated preview. Fetched (the list carries only a
  // preview). Prefill is cleared on a manual tab switch (below), so it's one-shot.
  const startDuplicate = async (row: JdRow) => {
    if (duplicating) return;
    setDuplicating(row.slug);
    let need = "";
    try {
      const src = (await fetch(`/api/jds/${encodeURIComponent(row.slug)}`).then((r) => r.json())) as
        | { body?: string; build_input_json?: string | null }
        | null;
      const prompt = readIntentPrompt(src?.build_input_json);
      need = prompt || (typeof src?.body === "string" ? src.body : row.preview ?? "");
    } catch {
      need = row.preview ?? "";
    }
    setPrefill({
      title: row.title,
      company: row.company ?? undefined,
      seniority: row.seniority ?? undefined,
      roleFamily: row.roleFamily ?? undefined,
      need,
    });
    setDuplicating(null);
    setOpenRow(null);
    // Advance builderKey so the (already-mounted) builder remounts with this prefill.
    setNav((s) => duplicateToBuilder(s));
  };

  const counts = useMemo(() => (rows ? statusCounts(rows) : null), [rows]);
  const visible = useMemo(
    () => (rows ? filterAndSortJds(rows, { query, status, field, seniority, sort: "recent" }) : []),
    [rows, query, status, field, seniority]
  );

  // Column-header dropdown options, each sorted by display name ascending. Field
  // and Seniority are data-driven facets (only values present in the library);
  // Status is the curated lifecycle enum with its per-status counts.
  const fieldOptions = useMemo<FilterOption[]>(
    () =>
      rows
        ? facetCounts(rows, (r) => r.roleFamily)
            .map((o) => ({ value: o.value, label: enumLabel("family", o.value), count: o.count }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : [],
    [rows, enumLabel]
  );
  const seniorityOptions = useMemo<FilterOption[]>(
    () =>
      rows
        ? facetCounts(rows, (r) => r.seniority)
            .map((o) => {
              const meta = seniorityMeta(o.value);
              return { value: o.value.toLowerCase(), label: meta?.label ?? labelize(o.value), count: o.count, icon: meta?.icon };
            })
            .sort((a, b) => a.label.localeCompare(b.label))
        : [],
    [rows]
  );
  const statusOptions = useMemo<FilterOption[]>(
    () =>
      STATUS_FILTERS.filter((f) => f.value !== "all")
        .map((f) => ({ value: f.value, label: f.label, count: counts ? counts[f.value] : undefined }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [counts]
  );

  return (
    <div className="mt-5">
      <SegmentedControl
        label={t("sectionLabel")}
        value={nav.tab}
        // A manual switch clears any pending Duplicate prefill so it can't re-seed a
        // form the user opened themselves — the prefill only survives the
        // programmatic switch startDuplicate does. It keeps nav.builderKey, so the
        // builder is NOT remounted and a half-typed draft survives the swap
        // (bug-ui-scan-2026-07-09 jd-authoring-library-templates #2).
        onChange={(v) => {
          setPrefill(null);
          setNav((s) => switchTab(s, v));
        }}
        options={[
          { value: "saved", label: t("savedJds") },
          { value: "generate", label: t("generate") },
        ]}
      />

      {/* #2 — both panels stay mounted so switching tabs can't unmount the builder
          and discard a typed JD draft; the inactive one is display:none. The
          Generate panel is keyed by nav.builderKey so ONLY a Duplicate remounts it. */}
      <div className={nav.tab === "generate" ? "mt-5" : "hidden"}>
        <LibraryGeneratePanel key={nav.builderKey} onSaved={reload} prefill={prefill} />
      </div>
      <div className={nav.tab === "saved" ? "mt-5" : "hidden"}>
          {ingested ? (
            <CompletionCta
              className="mb-4"
              message={t("ingestedBanner", { slug: ingested.slug })}
              links={[{ label: t("ingestedBannerCta"), tab: "jobs", params: ingested.jobId ? { job: ingested.jobId } : undefined }]}
              onDismiss={() => setIngested(null)}
              dismissLabel={t("ingestedDismiss")}
            />
          ) : null}

          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
            {error ? (
              <div className="flex flex-col items-start gap-3 px-4 py-5">
                <p className="text-base text-red-700">{error}</p>
                <button type="button" onClick={reload} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-stone-50">
                  {t("tryAgain")}
                </button>
              </div>
            ) : rows == null ? (
              <LedgerSkeleton />
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-base text-steel">{t("emptyNoJds")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-stone-200">
                      {/* Role — the search affordance lives here (no separate toolbar). */}
                      <th scope="col" className={`${META_LABEL} px-4 py-2.5`}>
                        {searchOpen || query ? (
                          <div className="relative flex items-center">
                            <Search size={14} className="pointer-events-none absolute left-2 text-steel" aria-hidden />
                            <input
                              autoFocus
                              type="search"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setQuery("");
                                  setSearchOpen(false);
                                }
                              }}
                              placeholder={t("searchRoles")}
                              aria-label={t("searchAria")}
                              className="focus-ring h-7 w-44 rounded border border-stone-300 bg-white pl-7 pr-6 text-sm font-normal normal-case tracking-normal text-ink caret-coral placeholder:text-steel"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setQuery("");
                                setSearchOpen(false);
                              }}
                              className="focus-ring absolute right-1 rounded p-0.5 text-steel transition-colors hover:text-ink"
                              aria-label={t("clearSearch")}
                            >
                              <X size={13} aria-hidden />
                            </button>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            {t("colRole")}
                            <button
                              type="button"
                              onClick={() => setSearchOpen(true)}
                              className="focus-ring rounded p-0.5 text-steel transition-colors hover:text-ink"
                              aria-label={t("searchRoles")}
                              title={t("searchRoles")}
                            >
                              <Search size={13} aria-hidden />
                            </button>
                          </span>
                        )}
                      </th>
                      <th scope="col" className={`${META_LABEL} px-4 py-2.5`}>
                        <ColumnHeaderFilter title={t("colField")} options={fieldOptions} selected={field} onSelect={setField} />
                      </th>
                      <th scope="col" className={`${META_LABEL} px-4 py-2.5`}>
                        <ColumnHeaderFilter title={t("colSeniority")} options={seniorityOptions} selected={seniority} onSelect={setSeniority} />
                      </th>
                      <th scope="col" className={`${META_LABEL} px-4 py-2.5`}>
                        <ColumnHeaderFilter
                          title={t("colStatus")}
                          options={statusOptions}
                          selected={status === "all" ? null : status}
                          onSelect={(v) => setStatus((v as StatusFilter) ?? "all")}
                        />
                      </th>
                      <th scope="col" className={`${META_LABEL} whitespace-nowrap px-4 py-2.5`}>{t("colAnalyzed")}</th>
                      <th scope="col" className={`${META_LABEL} whitespace-nowrap px-4 py-2.5`}>{t("colSaved")}</th>
                      <th scope="col" className={`${META_LABEL} px-4 py-2.5 text-right`}>{t("colActions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={COLS} className="px-4 py-10 text-center">
                          <p className="text-base font-semibold text-ink">{t("noMatchTitle")}</p>
                          <p className="mt-1 text-base text-steel">{query.trim() ? t("noMatchBody", { query: query.trim() }) : t("noMatchFilters")}</p>
                        </td>
                      </tr>
                    ) : (
                      visible.map((row) => {
                        const chip = jdStatusChip(row);
                        const analyzed = row.analysisCount ?? 0;
                        return (
                          <tr key={row.slug} className="group transition-colors hover:bg-paper">
                            <td className="px-4 py-2.5 align-middle">
                              <button
                                type="button"
                                onClick={() => setOpenRow(row)}
                                className="focus-ring block max-w-[26rem] truncate text-left text-sm font-semibold text-ink hover:text-coral"
                                title={row.title}
                              >
                                {row.title}
                              </button>
                            </td>
                            <td className="px-4 py-2.5 align-middle text-sm text-steel">
                              {row.roleFamily ? enumLabel("family", row.roleFamily) : <span className="text-stone-400">—</span>}
                            </td>
                            <td className="px-4 py-2.5 align-middle">
                              <SeniorityCell value={row.seniority} />
                            </td>
                            <td className="px-4 py-2.5 align-middle">
                              {row.analysis_status === "analyzing" ? (
                                <AnalyzingChip />
                              ) : (
                                <Badge tone={chip.tone} icon={chip.icon} label={chip.label} ariaLabel={chip.ariaLabel} muted={isUnlinked(row)} />
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-middle">
                              <span className={`inline-flex items-center gap-1.5 text-sm ${analyzed ? "text-ink" : "text-stone-400"}`}>
                                <Users size={14} aria-hidden />
                                <span className="nums font-semibold">{analyzed}</span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 align-middle text-sm text-steel">{shortDate(row.created_at)}</td>
                            <td className="px-4 py-2.5 align-middle">
                              <div className="flex items-center justify-end gap-0.5">
                                <button type="button" onClick={() => setOpenRow(row)} className={ICON_BTN} title={t("openDetail")} aria-label={t("openDetailAria", { title: row.title })}>
                                  <Maximize2 size={15} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startDuplicate(row)}
                                  disabled={duplicating === row.slug || row.analysis_status === "analyzing"}
                                  className={ICON_BTN}
                                  title={row.analysis_status === "analyzing" ? t("stillAnalyzing") : t("duplicateIntoForm")}
                                  aria-label={t("duplicateAria", { title: row.title })}
                                >
                                  {duplicating === row.slug ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Copy size={15} aria-hidden />}
                                </button>
                                {isUnlinked(row) ? (
                                  <RowIngest row={row} reload={reload} onIngested={(jobId) => setIngested({ slug: row.slug, jobId })} />
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {rows && visible.length > 0 ? (
              <div className="border-t border-stone-200 px-4 py-2 text-right text-xs uppercase tracking-wide text-steel">
                {t("entryCount", { count: visible.length })}
              </div>
            ) : null}
          </div>
        </div>

      {openRow ? (
        <LedgerDetailModal
          row={openRow}
          onClose={() => setOpenRow(null)}
          onDuplicate={startDuplicate}
          duplicating={duplicating === openRow.slug}
          onIngested={(jobId) => {
            setIngested({ slug: openRow.slug, jobId });
            setOpenRow(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

// The "Analyzing" status chip with a spinning glyph — matches Badge's `info` tone
// (bg-blue-50/text-blue-700) but animates, which the shared Badge (fixed icon
// class) can't. Used wherever a JD is mid-build.
function AnalyzingChip() {
  const t = useTranslations("library.tab");
  return (
    <span
      aria-label={t("analyzingAria")}
      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-sm font-semibold text-blue-700"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      <span>{t("analyzingLabel")}</span>
    </span>
  );
}

// Seniority as a single lucide glyph (icon-only column). The word is the tooltip +
// screen-reader name; an unknown/absent value degrades to an em dash.
function SeniorityCell({ value }: { value: string | null | undefined }) {
  const meta = seniorityMeta(value);
  if (!meta) return <span className="text-stone-400">—</span>;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center text-steel" title={meta.label}>
      <Icon size={16} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

// A column-header enum filter: the title doubles as the dropdown trigger, with a
// coral dot when a value is active. Options are the (pre-sorted) enum values plus
// an "All" reset. Closes on outside-click or Escape.
//
// #4 — this is a MENU of single-select choices, not a listbox: the old markup
// announced `aria-haspopup="listbox"` + `role="option"` on focusable <button>s but
// implemented none of the listbox keyboard contract (no focus-in on open, no arrow
// navigation, no aria-activedescendant/controls), which misleads assistive tech.
// Rebuilt as an honest `role="menu"` of `role="menuitemradio"` buttons with real
// roving focus (focus the selected item on open, Arrow/Home/End move focus,
// aria-controls links trigger↔menu). bug-ui-scan-2026-07-09 (jd-authoring-library-templates #4)
function ColumnHeaderFilter({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: FilterOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  const t = useTranslations("library.tab");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  // The menu items in DOM order: the "All" reset (value null) then each option.
  const items: { value: string | null; label: string; count?: number; icon?: LucideIcon }[] = [
    { value: null, label: t("filterAll") },
    ...options,
  ];
  // Focus target on open: the currently-selected item, else "All" (index 0).
  const selectedIndex = Math.max(0, items.findIndex((it) => it.value === selected));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // return focus to the trigger, per menu semantics
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // On open, move focus INTO the menu (the selected item) so keyboard/SR users land
  // where the listbox contract promised but never delivered.
  useEffect(() => {
    if (open) itemRefs.current[selectedIndex]?.focus();
  }, [open, selectedIndex]);

  const activeLabel = selected ? options.find((o) => o.value === selected)?.label : null;

  const choose = (value: string | null) => {
    onSelect(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Roving focus: Arrow/Home/End move DOM focus between the (natively focusable)
  // menuitem buttons; the pure index math lives in ledger-nav (unit-tested).
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuIndex(cur, e.key, items.length);
    if (next == null) return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={activeLabel ? t("filterActive", { name: title, value: activeLabel }) : t("filterBy", { name: title })}
        className={`focus-ring -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-ink ${selected ? "text-coral" : ""}`}
      >
        <span>{title}</span>
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden /> : null}
        <ChevronDown size={12} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("filterBy", { name: title })}
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-20 mt-1 max-h-72 min-w-[11rem] overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-pop"
        >
          {items.map((it, idx) => (
            <FilterRow
              key={it.value ?? "__all__"}
              ref={(el) => { itemRefs.current[idx] = el; }}
              label={it.label}
              count={it.count}
              icon={it.icon}
              active={selected === it.value}
              onClick={() => choose(it.value)}
            />
          ))}
          {options.length === 0 ? <p className="px-3 py-2 text-xs normal-case tracking-normal text-steel">{t("filterNoValues")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// A single filter choice. `role="menuitemradio"` + `aria-checked` is honest about
// the single-select semantics (unlike the old `role="option"`, which promised
// listbox behaviour); the button stays natively focusable so the parent menu can
// rove focus with the arrow keys. bug-ui-scan-2026-07-09 (jd-authoring-library-templates #4)
const FilterRow = forwardRef<HTMLButtonElement, { label: string; count?: number; icon?: LucideIcon; active: boolean; onClick: () => void }>(
  function FilterRow({ label, count, icon: Icon, active, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        className={`focus-ring flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm normal-case tracking-normal transition-colors hover:bg-paper ${active ? "font-semibold text-coral" : "text-ink"}`}
      >
        {Icon ? <Icon size={14} aria-hidden className="shrink-0 text-steel" /> : null}
        <span className="flex-1 truncate">{label}</span>
        {typeof count === "number" ? <span className="nums text-xs text-steel">{count}</span> : null}
        {active ? <Check size={13} aria-hidden className="shrink-0" /> : null}
      </button>
    );
  }
);

function RowIngest({ row, reload, onIngested }: { row: JdRow; reload: () => void; onIngested: (jobId: string | null) => void }) {
  const t = useTranslations("library.tab");
  const { state, run } = useIngestJob(row.slug, (jobId) => {
    onIngested(jobId);
    reload();
  });
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === "busy"}
      className={`${ICON_BTN} ${state === "error" ? "text-coral" : "hover:text-coral"}`}
      title={state === "error" ? t("ingestRetryBrief") : t("ingestAsJobBrief")}
      aria-label={t("ingestRowAria", { title: row.title })}
    >
      {state === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Briefcase size={15} aria-hidden />}
    </button>
  );
}

function LedgerDetailModal({
  row,
  onClose,
  onDuplicate,
  duplicating,
  onIngested,
}: {
  row: JdRow;
  onClose: () => void;
  onDuplicate: (row: JdRow) => void;
  duplicating: boolean;
  onIngested: (jobId: string | null) => void;
}) {
  const t = useTranslations("library.tab");
  const { jd, status, refresh } = useJdDetail(row.slug);
  // Prefer the freshly-fetched detail's state over the (snapshot) row, so a
  // poll-driven flip to ready/failed is reflected without reopening.
  const analysisStatus = jd?.analysis_status ?? row.analysis_status ?? null;
  const analyzing = analysisStatus === "analyzing";
  const failed = analysisStatus === "failed";
  const effRow = { ...row, analysis_status: analysisStatus };
  const chip = jdStatusChip(effRow);
  const ing = useIngestJob(row.slug, (jobId) => onIngested(jobId));
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // While the build runs, poll the detail so it flips to the result in place.
  useEffect(() => {
    if (!analyzing) return;
    const id = setInterval(refresh, 3500);
    return () => clearInterval(id);
  }, [analyzing, refresh]);

  // Structured artifacts (salary / case) the build stored beside the markdown body.
  // Parsed inline (the modal renders infrequently and the blob is small).
  const artifacts = parseArtifacts(jd?.analysis_json);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const r = await fetch(`/api/jds/${encodeURIComponent(row.slug)}/retry-analysis`, { method: "POST" });
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        throw new Error(p.error ?? t("retryFailed"));
      }
      refresh(); // reflects the reset-to-analyzing state; the poll then tracks it
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : t("retryFailed"));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Modal title={row.title} subtitle={row.slug} onClose={onClose} size="4xl">
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        {/* Metadata rail */}
        <aside className="space-y-4">
          <div className="space-y-2">
            <p className={META_LABEL}>{t("colStatus")}</p>
            {analyzing ? (
              <AnalyzingChip />
            ) : (
              <Badge tone={chip.tone} icon={chip.icon} label={chip.label} ariaLabel={chip.ariaLabel} muted={isUnlinked(effRow)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-pop">
              <p className={META_LABEL}>{t("colAnalyzed")}</p>
              <p className="font-serif text-h2 leading-none text-ink nums">{row.analysisCount ?? 0}</p>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 shadow-pop">
              <p className={META_LABEL}>{t("colSaved")}</p>
              <p className="mt-1 text-sm font-semibold text-ink">{shortDate(row.created_at)}</p>
            </div>
          </div>
          <div className="space-y-2 border-t border-stone-200 pt-4">
            <button
              type="button"
              onClick={() => onDuplicate(row)}
              disabled={duplicating || analyzing}
              className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
            >
              {duplicating ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Copy size={15} aria-hidden />}
              {t("duplicate")}
            </button>
            {isUnlinked(row) ? (
              <button
                type="button"
                onClick={ing.run}
                disabled={ing.state === "busy"}
                className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
              >
                {ing.state === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Briefcase size={15} aria-hidden />}
                {ing.state === "error" ? t("ingestRetry") : t("ingestAsJob")}
              </button>
            ) : null}
            <Link href={`/jds/${encodeURIComponent(row.slug)}`} className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink hover:border-coral/40">
              <ExternalLink size={15} aria-hidden /> {t("detailOpenPublic")}
            </Link>
            <Link href={`/?tab=analyze&jd=${encodeURIComponent(row.slug)}`} className="focus-ring flex w-full items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-steel">
              <Sparkles size={15} aria-hidden /> {t("detailAnalyzeCv")}
            </Link>
          </div>
          <div className="space-y-2 border-t border-stone-200 pt-4">
            <p className={META_LABEL}>{t("candidatesToggle", { count: row.analysisCount ?? 0 })}</p>
            <JdCandidateList slug={row.slug} count={row.analysisCount ?? 0} />
          </div>
        </aside>

        {/* Rendered posting — plus the in-progress / failed states of a backgrounded build. */}
        <section className="min-w-0">
          {analyzing ? (
            <BuildingPanel />
          ) : failed ? (
            <FailedPanel error={jd?.analysis_error ?? null} retrying={retrying} retryError={retryError} onRetry={retry} />
          ) : status === "loading" ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : status === "error" || !jd ? (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{t("detailLoadError")}</p>
          ) : (
            <div className="space-y-4">
              {artifacts?.salary ? <SalaryCard salary={artifacts.salary} sources={artifacts.salarySources} source={artifacts.salarySource} /> : null}
              {jd.body.trim() ? (
                <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
                  <Markdown content={jd.body} />
                </article>
              ) : (
                <p className="text-sm italic text-steel">{t("noDescriptionYet")}</p>
              )}
              {hasCaseContent(artifacts?.case) ? <CaseCard kase={artifacts!.case as CaseArtifact} /> : null}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

// The structured artifacts the jd_build handler stores in jds.analysis_json — the
// same payload runJdBuild returns, minus the markdown body (that's jds.body).
type CaseArtifact = { title?: string; brief?: string; tasks?: unknown[]; timeboxHours?: number };
type Artifacts = {
  role?: Record<string, unknown>;
  salary?: unknown;
  salarySources?: string[];
  salarySource?: string;
  case?: CaseArtifact | null;
  options?: { description?: boolean; marketResearch?: boolean; caseDesign?: boolean };
};

function parseArtifacts(json: string | null | undefined): Artifacts | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Artifacts;
  } catch {
    return null;
  }
}

function hasCaseContent(kase: CaseArtifact | null | undefined): kase is CaseArtifact {
  return !!kase && (Boolean(kase.title) || Boolean(kase.brief) || (Array.isArray(kase.tasks) && kase.tasks.length > 0));
}

// In-progress placeholder shown in the detail while the detached build runs.
function BuildingPanel() {
  const t = useTranslations("library.tab");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-12 text-center">
      <Loader2 size={28} className="animate-spin text-blue-700" aria-hidden />
      <p className="text-sm font-semibold text-ink">{t("buildingTitle")}</p>
      <p className="max-w-sm text-sm text-steel">{t("buildingBody")}</p>
    </div>
  );
}

// Failed build — the error plus a one-click retry (replays the original inputs).
function FailedPanel({ error, retrying, retryError, onRetry }: { error: string | null; retrying: boolean; retryError: string | null; onRetry: () => void }) {
  const t = useTranslations("library.tab");
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
        <AlertTriangle size={16} aria-hidden /> {t("buildFailedTitle")}
      </p>
      {error ? <p className="mt-2 break-words text-sm text-red-700/90">{error}</p> : null}
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="focus-ring mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
      >
        {retrying ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
        {t("retryBuild")}
      </button>
      {retryError ? <p className="mt-2 text-sm text-red-700">{retryError}</p> : null}
    </div>
  );
}

// Read-only market-salary card (the band is AI-fixed; editing lives on the public
// page) — the recruiter-facing surface for the grounded band + its cited sources.
function SalaryCard({ salary, sources, source }: { salary: unknown; sources?: string[]; source?: string }) {
  const t = useTranslations("library.tab");
  const s = normalizeMarketSalary(salary);
  const links = dedupeBy(safeHttpLinks(sources ?? []), (l) => l.href).slice(0, 3);
  const provenance = source === "llm" ? t("provWebGrounded") : source === "deterministic" ? t("provEstimated") : source ?? t("provEstimated");
  return (
    <div className="rounded-lg border border-stone-200 bg-paper/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta uppercase tracking-wide text-steel">{t("marketSalary")} · {provenance}</p>
        {s.available ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-ink">
            <Lock size={12} className="text-steel" aria-hidden />
            {formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency })} · {s.confidence}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-sm font-semibold text-steel">
            <AlertTriangle size={12} className="text-amber-500" aria-hidden /> {t("salaryUnavailable")}
          </span>
        )}
      </div>
      {s.summary ? <p className="mt-1.5 text-sm text-ink">{s.summary}</p> : null}
      {links.length ? (
        <p className="mt-1 text-sm text-steel">
          {t("sourcesLabel")}{" "}
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 ? " · " : ""}
              <a href={l.href} target="_blank" rel="noreferrer" className="text-coral hover:underline">{l.hostname}</a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

// The interview case (shown when "Case analysis" was ticked) — read-only overview.
function CaseCard({ kase }: { kase: CaseArtifact }) {
  const t = useTranslations("library.tab");
  const tasks = Array.isArray(kase.tasks) ? kase.tasks : [];
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="text-meta uppercase tracking-wide text-coral">{t("interviewCase")}</p>
      {kase.title ? <h3 className="mt-1 font-serif text-h3 font-semibold text-ink">{kase.title}</h3> : null}
      {kase.brief ? <p className="mt-2 whitespace-pre-line text-sm text-steel">{kase.brief}</p> : null}
      {tasks.length ? (
        <ul className="mt-3 space-y-1">
          {tasks.map((task, i) => (
            <li key={i} className="text-sm text-ink">• {caseTaskLabel(task)}</li>
          ))}
        </ul>
      ) : null}
      {typeof kase.timeboxHours === "number" ? <p className="mt-2 text-sm text-steel">{t("timebox", { hours: kase.timeboxHours })}</p> : null}
    </div>
  );
}

function caseTaskLabel(task: unknown): string {
  if (typeof task === "string") return task;
  if (task && typeof task === "object") {
    const o = task as Record<string, unknown>;
    return String(o.title ?? o.prompt ?? o.name ?? o.description ?? "Task");
  }
  return "Task";
}

// The recruiter's original "describe the need" prompt out of a JD's persisted build
// intent (build_input_json), or "" when absent/legacy/malformed — so Duplicate can
// prefer intent over the rendered body without the caller re-parsing JSON.
function readIntentPrompt(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const intent = JSON.parse(json) as { needText?: unknown };
    return typeof intent.needText === "string" ? intent.needText.trim() : "";
  } catch {
    return "";
  }
}

function LedgerSkeleton() {
  return (
    <div className="divide-y divide-stone-200">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-5" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}
