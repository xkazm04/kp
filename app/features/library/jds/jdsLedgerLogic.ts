// State + derived data for LibrarySavedJdsLedger.tsx — extracted so the ledger
// file stays under the 200-line split threshold. Owns: the library fetch +
// analyzing poll, the Duplicate handoff to the Job-intake tab, the
// winnability-coach one-shot deep link, and the search/field/seniority/status
// filter state + derived option lists.
//
// The sub-tab state that used to live here went with the authoring panels
// (JdsIntakeTab.tsx). What is left of the Duplicate handoff is a NAVIGATION: the
// builder is no longer on this page, so the source slug rides the URL
// (?tab=intake&duplicate=<slug>) and the destination does the read.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { compareCells, useTableSort } from "@/app/_components/table/useTableSort";
import { useJdLibrary } from "./jdsHooks";
import {
  coachHandoffBlock,
  facetCounts,
  filterAndSortJds,
  seniorityMeta,
  statusCounts,
  STATUS_FILTERS,
  JD_SORT_ACCESSORS,
  type CoachHandoffBlock,
  type JdRow,
  type JdSortCol,
  type StatusFilter,
} from "./jdsLibrary";
import { parseCoachEditParam, COACH_EDIT_PARAM, type CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";
import { buildUrl } from "@/app/features/shell/tabs";
import { DUPLICATE_PARAM } from "./jdsIntakeTabEntry";
import type { FilterOption } from "./JdsLedgerFilterMenu";

export function useLedgerLogic() {
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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [field, setField] = useState<string | null>(null);
  const [seniority, setSeniority] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<JdRow | null>(null);
  const [ingested, setIngested] = useState<{ slug: string; jobId: string | null } | null>(null);

  // winnability-apply — one-shot handoff from the winnability coach: land here with
  // ?coachEdit=<kind~slug~delta~value> (grammar in sub_jobs/coach-apply.ts), open
  // the targeted JD in edit mode, and paint a dismissible suggestion banner in the
  // editor. Captured ONCE at mount (state initializer) because the param is one-shot
  // — the effect below strips it via history.replaceState so a refresh or shared
  // link can never re-stage a stale edit. Nothing auto-saves: the recruiter still
  // edits the free-text body and confirms through the existing CAS save path.
  const search = useSearchParams();
  const [coachEdit] = useState<CoachEdit | null>(() => parseCoachEditParam(search.get(COACH_EDIT_PARAM)));
  // Once the recruiter closes the auto-opened coach modal, the handoff is spent —
  // a later manual open of the same JD gets a clean modal, no banner.
  const [coachDismissed, setCoachDismissed] = useState(false);
  useEffect(() => {
    // Strip ?coachEdit= once (raw history write, not a React setState — the value is
    // already in mount state, so no re-render/nav churn; mirrors DecisionsTab's ?arm=).
    if (!search.has(COACH_EDIT_PARAM)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(COACH_EDIT_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Derived, not effect-set: the coach-targeted JD row once the library loads. A slug
  // that isn't here (e.g. a corpus job with no JD) resolves to null — fail-closed,
  // nothing opens. A manual open (openRow) always wins over the auto-open.
  const coachTargetRow = coachEdit && rows ? rows.find((r) => r.slug === coachEdit.slug) ?? null : null;
  // Why the handoff can't stage right now — null once the target is editable (or gone/
  // still loading). Re-derived per render: when the analyzing poll flips the row to
  // ready this drops to null, the modal auto-opens, and the note yields to the staged
  // banner. notFound/failed are dead-ends — the note simply stands (suggestion lost).
  const coachBlock: CoachHandoffBlock | null = coachEdit ? coachHandoffBlock(coachEdit.slug, rows) : null;
  // Auto-open only an EDITABLE target — never drop the recruiter into a modal that's
  // mid-build/failed (canEdit false there, so the suggestion couldn't arm anyway).
  const coachAutoOpenRow = coachBlock ? null : coachTargetRow;
  const effectiveOpenRow = openRow ?? (coachDismissed ? null : coachAutoOpenRow);
  // The dismissible trace note: shown while the handoff is live (not dismissed) and no
  // JD was opened manually. Dismissing it spends the handoff, same as closing a modal.
  const coachTrace: CoachHandoffBlock | null = !coachDismissed && !openRow ? coachBlock : null;
  // The staged suggestion rides only the auto-opened coach session (before dismissal).
  const stagedForOpenRow =
    effectiveOpenRow && coachEdit && !coachDismissed && !openRow && effectiveOpenRow.slug === coachEdit.slug
      ? coachEdit
      : null;
  const [duplicating, setDuplicating] = useState<string | null>(null);

  // Duplicate: open the Job-intake tab's builder seeded from this role. The two
  // surfaces no longer share a page, so the handoff is a deep link carrying the
  // SLUG (?duplicate=) and JdsIntakeTab does the `?intent=1` read — which is what
  // keeps a regenerated role designing from the recruiter's ORIGINAL prompt rather
  // than from the rendered markdown. `duplicating` still latches so the row's
  // spinner shows for the frame before the navigation commits.
  const startDuplicate = (row: JdRow) => {
    if (duplicating) return;
    setDuplicating(row.slug);
    setOpenRow(null);
    router.push(buildUrl({ tab: "intake", [DUPLICATE_PARAM]: row.slug }, search.toString()));
  };

  /** "Write a new one" — the empty state's CTA and the ledger's route into authoring. */
  const goToIntake = () => router.push(buildUrl({ tab: "intake" }, search.toString()));

  const counts = useMemo(() => (rows ? statusCounts(rows) : null), [rows]);
  // Two stages, deliberately: filterAndSortJds still owns FILTERING (and supplies
  // the newest-first default), then the shared useTableSort re-ranks that result
  // by whichever column the reader picked. Keeping them separate means the column
  // sort never has to re-implement the filter predicates, and "recent" stays the
  // ordering anyone who never touches a header sees.
  const filtered = useMemo(
    () => (rows ? filterAndSortJds(rows, { query, status, field, seniority }) : []),
    [rows, query, status, field, seniority]
  );
  const { sorted: visible, sort, toggle: onSort } = useTableSort<JdRow, JdSortCol>(filtered, JD_SORT_ACCESSORS, {
    col: "saved",
    dir: "desc",
  });

  // Column-header dropdown options, each sorted by display name ascending. Field
  // and Seniority are data-driven facets (only values present in the library);
  // Status is the curated lifecycle enum with its per-status counts.
  //
  // The labels are TRANSLATED, so they collate under the READER's locale — the same
  // rule the table body below already gets for free from useTableSort, through the
  // same collator. A bare `localeCompare()` uses the runtime default, which is the
  // SERVER's locale during SSR and the browser's after hydration: under `en` a Czech
  // reader's Field menu orders "Švec, Sýkora" where they expect "Sýkora, Švec", and
  // the two orders disagree across hydration. See compareCells.
  const locale = useLocale();
  const byLabel = useCallback(
    (a: { label: string }, b: { label: string }) => compareCells(a.label, b.label, "asc", locale),
    [locale]
  );
  const fieldOptions = useMemo<FilterOption[]>(
    () =>
      rows
        ? facetCounts(rows, (r) => r.roleFamily)
            .map((o) => ({ value: o.value, label: enumLabel("family", o.value), count: o.count }))
            .sort(byLabel)
        : [],
    [rows, enumLabel, byLabel]
  );
  const seniorityOptions = useMemo<FilterOption[]>(
    () =>
      rows
        ? facetCounts(rows, (r) => r.seniority)
            .map((o) => {
              const meta = seniorityMeta(o.value);
              // Localized via the shared enums.seniority catalog (enumLabel falls back
              // to labelize for any value without an entry) — no per-file English.
              return { value: o.value.toLowerCase(), label: enumLabel("seniority", o.value), count: o.count, icon: meta?.icon };
            })
            .sort(byLabel)
        : [],
    [rows, enumLabel, byLabel]
  );
  // Status-filter labels resolve to the SAME localized chip vocabulary the badges
  // use, so a filter option and the chip it selects for can never disagree.
  const statusFilterLabel = (value: StatusFilter): string => {
    switch (value) {
      case "analyzing":
        return t("analyzingLabel");
      case "live":
        return t("chipLive");
      case "draft":
        return t("chipDraft");
      case "unlinked":
        return t("chipUnlinked");
      default:
        return t("filterAll");
    }
  };
  const statusOptions = useMemo<FilterOption[]>(
    () =>
      STATUS_FILTERS.filter((f) => f.value !== "all")
        .map((f) => ({ value: f.value, label: statusFilterLabel(f.value), count: counts ? counts[f.value] : undefined }))
        .sort(byLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counts, t, byLabel]
  );

  return {
    t,
    rows,
    error,
    reload,
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    status,
    setStatus,
    field,
    setField,
    seniority,
    setSeniority,
    openRow,
    setOpenRow,
    ingested,
    setIngested,
    coachEdit,
    coachDismissed,
    setCoachDismissed,
    coachTargetRow,
    effectiveOpenRow,
    coachTrace,
    stagedForOpenRow,
    duplicating,
    startDuplicate,
    goToIntake,
    visible,
    sort,
    onSort,
    fieldOptions,
    seniorityOptions,
    statusOptions,
  };
}
