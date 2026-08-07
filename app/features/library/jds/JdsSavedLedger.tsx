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
//
// Split (200-line rule) across: jdsLedgerLogic.ts (state + derived data),
// JdsLedgerTable.tsx (the table), JdsLedgerDetailModal.tsx (the detail modal),
// JdsLedgerCoachTrace.tsx (the coach-handoff banner).

import dynamic from "next/dynamic";
import { Defer } from "@/app/_components/ui/Defer";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { switchTab } from "./jdsLedgerNav";
import { useLedgerLogic } from "./jdsLedgerLogic";
import { LedgerDetailModal } from "./JdsLedgerDetailModal";
import { JdsSavedLedgerPanel } from "./JdsSavedLedgerPanel";

// Tier 3 (docs/design/loading-choreography.md): both are click/tab-gated, not part of the
// ledger's first paint — the JD editor only mounts once a row's "Edit" is pressed,
// and the Generate builder (RichTextEditor, template management) is hidden behind
// the Saved/Generate switcher on first arrival. Each gets its own chunk with a
// quiet reserved-height gap instead of riding the table's entry payload.
const chunkGap = (minHeight: string) => {
  const Gap = () => <div className={`reveal-quiet ${minHeight}`} aria-hidden />;
  Gap.displayName = "LibraryChunkGap";
  return Gap;
};
const LibraryGeneratePanel = dynamic(() => import("./JdsGeneratePanel").then((m) => ({ default: m.LibraryGeneratePanel })), {
  loading: chunkGap("min-h-[20rem]"),
});
// Tier 3 like the builder: the intake dialog (chat + live brief) mounts only
// once the Intake sub-tab is opened.
const LibraryIntakePanel = dynamic(() => import("./intake/JdsIntakePanel").then((m) => ({ default: m.JdsIntakePanel })), {
  loading: chunkGap("min-h-[20rem]"),
});

export function LibrarySavedJdsLedger() {
  const {
    t,
    rows,
    error,
    reload,
    nav,
    setNav,
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
    ingested,
    setIngested,
    coachEdit,
    setCoachDismissed,
    coachTargetRow,
    effectiveOpenRow,
    coachTrace,
    stagedForOpenRow,
    prefill,
    setPrefill,
    duplicating,
    startDuplicate,
    visible,
    fieldOptions,
    seniorityOptions,
    statusOptions,
  } = useLedgerLogic();

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
          { value: "intake", label: t("intake.tabLabel") },
        ]}
      />

      {/* #2 — both panels stay mounted so switching tabs can't unmount the builder
          and discard a typed JD draft; the inactive one is display:none. The
          Generate panel is keyed by nav.builderKey so ONLY a Duplicate remounts it. */}
      <div className={nav.tab === "generate" ? "mt-5" : "hidden"}>
        {/* Tier 3: the builder is hidden on first arrival (default tab is "saved"),
            so it mounts an idle beat later rather than riding the ledger's entry
            payload. Once mounted it stays mounted (Defer never unmounts), which is
            what keeps a half-typed draft alive across a manual tab switch. */}
        <Defer strategy="idle" placeholder={<div className="reveal-quiet min-h-[20rem]" aria-hidden />}>
          <LibraryGeneratePanel key={nav.builderKey} onSaved={reload} prefill={prefill} />
        </Defer>
      </div>
      {/* Same mount contract as the builder: stays mounted once idle-mounted, so
          switching sub-tabs never discards an in-flight dialog's local state. */}
      <div className={nav.tab === "intake" ? "mt-5" : "hidden"}>
        <Defer strategy="idle" placeholder={<div className="reveal-quiet min-h-[20rem]" aria-hidden />}>
          <LibraryIntakePanel onPromoted={reload} />
        </Defer>
      </div>
      <JdsSavedLedgerPanel
        active={nav.tab === "saved"}
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
        duplicating={duplicating}
        onOpenRow={setOpenRow}
        onDuplicate={startDuplicate}
        onStartGenerate={() => {
          setPrefill(null);
          setNav((s) => switchTab(s, "generate"));
        }}
        t={t}
      />

      {effectiveOpenRow ? (
        <LedgerDetailModal
          row={effectiveOpenRow}
          stagedSuggestion={stagedForOpenRow}
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
