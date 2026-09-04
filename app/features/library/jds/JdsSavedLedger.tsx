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
// It is now the WHOLE library page. The Saved / Generate / Intake strip that used
// to sit on top of it is gone: authoring moved to its own sidebar item
// (JdsIntakeTab.tsx), because "which roles do I have" and "write me a new one" are
// two questions, and answering both on one page meant the ledger — the thing a
// returning recruiter comes for — opened behind a switcher.
//
// All user-facing copy threads next-intl `t()` (the `library.tab` namespace) — the
// column headers, filter menus, action tooltips, and detail-modal panels included —
// so cs/de/fr recruiters get a fully localized surface; the eslint
// i18next/no-literal-string gate is ON for this file (no blanket disable).
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #3)
//
// Split (200-line rule) across: jdsLedgerLogic.ts (state + derived data),
// JdsLedgerTable.tsx (the table), JdsLedgerDetailModal.tsx (the detail modal),
// JdsLedgerCoachTrace.tsx (the coach-handoff banner).

import { useLedgerLogic } from "./jdsLedgerLogic";
import { LedgerDetailModal } from "./JdsLedgerDetailModal";
import { JdsSavedLedgerPanel } from "./JdsSavedLedgerPanel";

export function LibrarySavedJdsLedger() {
  const {
    t,
    rows,
    total,
    truncated,
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
    setOpenRow,
    openRowAt,
    openHistoryFor,
    heldBuilds,
    pollStalled,
    ingested,
    setIngested,
    coachEdit,
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
  } = useLedgerLogic();

  return (
    <div className="mt-5">
      <JdsSavedLedgerPanel
        rows={rows}
        error={error}
        reload={reload}
        coachTrace={coachTrace}
        coachEdit={coachEdit}
        coachTargetRow={coachTargetRow}
        setCoachDismissed={setCoachDismissed}
        ingested={ingested}
        setIngested={setIngested}
        visible={visible}
        total={total}
        truncated={truncated}
        query={query}
        setQuery={setQuery}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        field={field}
        setField={setField}
        fieldOptions={fieldOptions}
        seniority={seniority}
        setSeniority={setSeniority}
        seniorityOptions={seniorityOptions}
        status={status}
        setStatus={setStatus}
        statusOptions={statusOptions}
        sort={sort}
        onSort={onSort}
        duplicating={duplicating}
        heldBuilds={heldBuilds}
        pollStalled={pollStalled}
        onOpenRow={openRowAt}
        onDuplicate={startDuplicate}
        onStartGenerate={goToIntake}
        t={t}
      />

      {effectiveOpenRow ? (
        <LedgerDetailModal
          row={effectiveOpenRow}
          stagedSuggestion={stagedForOpenRow}
          held={heldBuilds.has(effectiveOpenRow.slug)}
          openHistory={openHistoryFor === effectiveOpenRow.slug}
          onClose={() => {
            setOpenRow(null);
            setCoachDismissed(true);
          }}
          onDuplicate={startDuplicate}
          duplicating={duplicating === effectiveOpenRow.slug}
          onIngested={(jobId: string | null) => {
            setIngested({ slug: effectiveOpenRow.slug, jobId });
            setOpenRow(null);
            setCoachDismissed(true);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
