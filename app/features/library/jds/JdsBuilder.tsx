"use client";

import dynamic from "next/dynamic";
import { Check, Loader2, Save, Settings2, Sparkles } from "lucide-react";
import type { GeneratePrefill } from "./jdsLibrary";
import { JdLintPanel } from "./JdsLintPanel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { RichTextEditor } from "@/app/_components/RichTextEditor";
import { Select } from "@/app/_components/Select";
import { BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { TextInput } from "@/app/_components/TextInput";
import { useJdBuilderLogic } from "./jdsBuilderLogic";
import { JdsBuilderChecklist } from "./JdsBuilderChecklist";
import { Field, JdsBuilderFieldsGrid } from "./JdsBuilderFields";

// Tier 3 (docs/design/loading-choreography.md): the template manager only mounts once
// "Manage" is clicked — it never rides the builder's own entry payload.
const JdTemplateManager = dynamic(() => import("./JdsTemplateManager").then((m) => ({ default: m.JdTemplateManager })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

// AI job-description builder. "Generate" opens a checklist (description / market
// research / interview case) and hands the work to the detached jd_build task via
// POST /api/jds/generate: the JD appears in the Ledger immediately as "Analyzing"
// and fills in server-side, so it completes even if the recruiter navigates away.
// "Save as draft" still persists the form's own input straight to the library
// without any AI round-trip.
export function JdBuilder({ onSaved, prefill }: { onSaved: () => void; prefill?: GeneratePrefill }) {
  const logic = useJdBuilderLogic({ onSaved, prefill });
  const {
    t,
    title,
    setTitle,
    company,
    setCompany,
    seniority,
    setSeniority,
    roleFamily,
    setRoleFamily,
    needText,
    setNeedText,
    repoUrl,
    setRepoUrl,
    outputLang,
    setOutputLang,
    templates,
    templateId,
    setTemplateId,
    manageOpen,
    setManageOpen,
    error,
    loadTemplates,
    isSoftware,
    familyOptions,
    options,
    setOptions,
    lintFindings,
    checklistOpen,
    setChecklistOpen,
    submitting,
    queued,
    anyOption,
    inputOk,
    canStart,
    runGenerate,
    savingDraft,
    draftSaved,
    saveDraft,
    canSaveDraft,
  } = logic;
  const enumLabel = useEnumLabel();

  return (
    <div data-sim="jd-builder" className={`${PANEL} p-4`}>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={14} /> {t("generateWithAi")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("intro")}</p>

      {/* Pick the output format. The build renders the role through the chosen
          template server-side; an empty selection uses the AI's default layout. */}
      <div className="mt-3 flex items-end gap-2">
        <Field label={t("templateLabel")} className="flex-1">
          <Select
            ariaLabel={t("templateLabel")}
            value={templateId}
            onChange={setTemplateId}
            sizeVariant="sm"
            className="w-full"
            options={[
              { value: "", label: t("aiDefaultFormat") },
              ...templates.map((tpl) => ({ value: tpl.id, label: `${tpl.name}${tpl.isDefault ? t("defaultSuffix") : ""}` })),
            ]}
          />
        </Field>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className={`${BTN_SECONDARY} h-9 shrink-0 gap-1.5 px-2.5 text-sm font-semibold text-steel`}
          title={t("manageTitle")}
        >
          <Settings2 size={14} /> {t("manage")}
        </button>
      </div>

      <JdsBuilderFieldsGrid
        t={t}
        enumLabel={enumLabel}
        title={title}
        setTitle={setTitle}
        company={company}
        setCompany={setCompany}
        seniority={seniority}
        setSeniority={setSeniority}
        roleFamily={roleFamily}
        setRoleFamily={setRoleFamily}
        familyOptions={familyOptions}
        outputLang={outputLang}
        setOutputLang={setOutputLang}
      />

      <Field label={t("describeNeed")} className="mt-2">
        <RichTextEditor
          value={needText}
          onChange={setNeedText}
          placeholder={t("needPlaceholder")}
          ariaLabel={t("describeNeed")}
          minHeight="8rem"
        />
      </Field>
      {/* Advisory lint over the editor body — surfaces boilerplate / missing pay·place /
          non-inclusive wording as the recruiter drafts. Hidden at zero findings (no
          empty chrome); never blocks Generate or Save-as-draft. */}
      {lintFindings.length > 0 ? <JdLintPanel findings={lintFindings} /> : null}
      {/* Codebase enrichment is a dev-role feature — shown only when Field = Software. */}
      {isSoftware ? (
        <Field label={t("codebaseLabel")} className="mt-2">
          <TextInput value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder={t("codebasePlaceholder")} sizeVariant="sm" />
        </Field>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <JdsBuilderChecklist
          t={t}
          checklistOpen={checklistOpen}
          setChecklistOpen={setChecklistOpen}
          submitting={submitting}
          options={options}
          setOptions={setOptions}
          anyOption={anyOption}
          inputOk={inputOk}
          canStart={canStart}
          runGenerate={runGenerate}
        />
        <button
          type="button"
          onClick={saveDraft}
          disabled={!canSaveDraft}
          title={t("saveDraft")}
          className={`${BTN_SECONDARY} h-10 gap-2 px-4 text-sm font-semibold`}
        >
          {savingDraft ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {savingDraft ? t("savingDraft") : t("saveDraft")}
        </button>
        {queued ? (
          <span className="animate-fade-in inline-flex items-center gap-1 text-sm font-semibold text-moss" role="status">
            <Check size={16} aria-hidden /> {t("queued")}
          </span>
        ) : draftSaved ? (
          <span className="animate-fade-in inline-flex items-center gap-1 text-sm font-semibold text-moss" role="status">
            <Check size={16} aria-hidden /> {t("draftSaved")}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {manageOpen ? <JdTemplateManager onClose={() => setManageOpen(false)} onChanged={loadTemplates} /> : null}
    </div>
  );
}
