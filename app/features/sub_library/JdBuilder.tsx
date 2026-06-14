"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Settings2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { isLocale, LOCALES } from "@/i18n/locales";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { JdBuilderResult, type JdBuildResult } from "./JdBuilderResult";
import { JdTemplateManager } from "./JdTemplateManager";
import { fetchTemplates, renderTemplate, type Template } from "./render-template";
import { marketSalaryLabel, normalizeMarketSalary } from "@/app/_lib/salary-band";
import { validateJdBuildInput } from "@/app/_lib/jd-limits";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

const SENIORITIES = ["junior", "medior", "senior", "lead"];
// Role-family slugs (canonical; the display label comes from the enums catalog).
const FAMILIES = ["software_engineering", "data_ai", "product_project"];
const INP = "focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm";

// AI job-description builder: free-text need (+ optional public GitHub repo for
// dev roles) → our need→design machinery → an editable, publishable JD with a
// web-grounded market-salary analysis.
export function JdBuilder({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations("library.builder");
  const enumLabel = useEnumLabel();
  const { startTask } = useTasks();
  // Deep-link / simulation prefill (jd* query params) — mirrors MatchTab's pattern.
  const sp = useSearchParams();
  const [title, setTitle] = useState(sp.get("jdTitle") ?? "");
  const [company, setCompany] = useState(sp.get("jdCompany") ?? "");
  const [seniority, setSeniority] = useState(sp.get("jdSeniority") ?? "medior");
  const [roleFamily, setRoleFamily] = useState(sp.get("jdFamily") ?? "software_engineering");
  const [needText, setNeedText] = useState(sp.get("jdNeed") ?? "");
  const [repoUrl, setRepoUrl] = useState("");
  // JDL5 — the generated JD's output language, defaulting to the active locale
  // (a Czech-market recruiter gets a Czech JD without hand-translating). The
  // role content + salary summary generate in it; composeMarkdown headings too.
  const appLocale = useLocale();
  const [outputLang, setOutputLang] = useState(isLocale(appLocale) ? appLocale : "en");

  // Template-first authoring: pick a company format, then let AI fill it. An
  // empty templateId means "use the AI's own default formatting".
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  // Template-switch contract (see docs/JD_LIFECYCLE.md): templates are a LIVE
  // reformat — switching after generation re-renders the AI output through the
  // new format, which replaces the editable body. That is the intended behavior
  // when the body is untouched, but it would silently discard manual edits. So
  // when the result has been hand-edited (resultDirty), a switch is staged in
  // pendingTemplateId and an inline confirm gates it instead of applying at once.
  const [resultDirty, setResultDirty] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<JdBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = () =>
    fetchTemplates().then((list) => {
      setTemplates(list);
      // Keep the current selection if it still exists; else default to the
      // marked default, else the first (matches JdTemplates' reconciliation).
      setTemplateId((cur) => (list.some((t) => t.id === cur) ? cur : list.find((t) => t.isDefault)?.id ?? list[0]?.id ?? ""));
    });
  useEffect(() => {
    loadTemplates();
  }, []);

  // taskId brackets the whole in-progress lifecycle: it's held until the on-demand
  // result fetch lands (success) or an error is recorded (failure), so it doubles
  // as the "generating" signal — no flash of the empty state during the fetch.
  const { status: buildStatus, error: buildError, progressMsg: buildProgress, full: buildFull } = useTaskResult(taskId);
  const generating = Boolean(taskId);

  // The AI build produces a structured RoleSpec + salary; if a template is
  // selected we render those fields THROUGH it (so the AI output adopts the
  // chosen company format), otherwise we keep the builder's default markdown.
  const displayResult = useMemo<JdBuildResult | null>(() => {
    if (!result) return null;
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return result;
    const role = (result.role ?? {}) as {
      responsibilities?: string[];
      mustHaves?: string[];
      niceToHaves?: string[];
    };
    // Normalize at this boundary too: the template label must never bake a
    // bogus "0–N" range (or "undefined") from a partial CLI band into the
    // rendered JD body — an unavailable band yields an empty label, so the
    // template's salary slot simply renders blank.
    const salaryLabel = marketSalaryLabel(normalizeMarketSalary(result.salary));
    const markdown = renderTemplate(tpl.body, {
      title: title.trim(),
      company: company.trim(),
      seniority,
      salary: salaryLabel,
      responsibilities: role.responsibilities ?? [],
      mustHaves: role.mustHaves ?? [],
      niceToHaves: role.niceToHaves ?? [],
    });
    return { ...result, markdown };
  }, [result, templates, templateId, title, company, seniority]);

  // Build-task completion is consumed DURING render (guarded: the task id is
  // cleared in the same pass, so this runs once per task) — the guarded
  // render-phase pattern instead of an effect round-trip.
  if (taskId && buildStatus === "succeeded" && buildFull) {
    setResult((buildFull.result as JdBuildResult) ?? null);
    setTaskId(null);
  } else if (taskId && (buildStatus === "failed" || buildStatus === "canceled" || buildStatus === "interrupted")) {
    setError(buildError ?? t("genFailed"));
    setTaskId(null);
  }

  // Commit a template choice: re-render the body through it (the JdBuilderResult
  // remount keyed by templateId does the actual reformat) and clear any staged
  // switch. The freshly mounted result reports edited=false, resetting resultDirty.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    setPendingTemplateId(null);
  };

  // Selector entry point. With unsaved hand-edits we stage the switch and let the
  // inline confirm decide; otherwise we reformat immediately (the common case,
  // kept frictionless). No result on screen → nothing to protect, apply at once.
  const onSelectTemplate = (id: string) => {
    if (resultDirty && displayResult) setPendingTemplateId(id);
    else applyTemplate(id);
  };

  const generate = async () => {
    setError(null);
    setResult(null);
    // A new build replaces any prior result, so no edits are pending discard.
    setResultDirty(false);
    setPendingTemplateId(null);
    const started = await startTask("jd_build", { title: title.trim(), company: company.trim(), seniority, roleFamily, needText: needText.trim(), repoUrl: repoUrl.trim(), lang: outputLang });
    if (started) setTaskId(started.id);
    else setError(t("startFailed"));
  };

  // Same minimum-need contract the server enforces in runJdBuild — shared so the
  // disabled-button gate and the AI boundary can never drift on the thresholds.
  const canGenerate = validateJdBuildInput(title, needText).ok && !generating;

  return (
    <div data-sim="jd-builder" className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={14} /> {t("generateWithAi")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("intro")}</p>

      {/* Step 1: pick the output format. The AI fills whichever template is chosen.
          After generation this doubles as a live reformat — see the switch contract
          on pendingTemplateId above. The selector reflects a staged switch
          (pendingTemplateId) until the inline confirm below resolves it. */}
      <div className="mt-3 flex items-end gap-2">
        <Field label={t("templateLabel")} className="flex-1">
          <select value={pendingTemplateId ?? templateId} onChange={(e) => onSelectTemplate(e.target.value)} className={INP}>
            <option value="">{t("aiDefaultFormat")}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
                {tpl.isDefault ? t("defaultSuffix") : ""}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-steel hover:bg-stone-50"
          title={t("manageTitle")}
        >
          <Settings2 size={14} /> {t("manage")}
        </button>
      </div>

      {/* Guard the destructive reformat: a staged switch (only set when the body
          has unsaved hand-edits) waits here for explicit confirmation. Mirrors the
          inline Confirm/Cancel idiom in JdTemplateManager. */}
      {pendingTemplateId !== null ? (
        <div className="animate-fade-in mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800" role="group" aria-label={t("confirmSwitchAria")}>
          <span>{t("switchWarning")}</span>
          <span className="ml-auto inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => applyTemplate(pendingTemplateId)}
              className="focus-ring rounded-md border border-red-300 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
            >
              {t("replaceEdits")}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => setPendingTemplateId(null)}
              className="focus-ring rounded-md px-2.5 py-1 font-semibold text-steel hover:bg-stone-100"
            >
              {t("keepEditing")}
            </button>
          </span>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label={t("roleTitle")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("roleTitlePlaceholder")} className={INP} />
        </Field>
        <Field label={t("company")}>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("companyPlaceholder")} className={INP} />
        </Field>
        <Field label={t("seniority")}>
          <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className={`${INP} capitalize`}>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>{enumLabel("seniority", s)}</option>
            ))}
          </select>
        </Field>
        <Field label={t("field")}>
          <select value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)} className={INP}>
            {FAMILIES.map((f) => (
              <option key={f} value={f}>{enumLabel("family", f)}</option>
            ))}
          </select>
        </Field>
        {/* JDL5 — generate the JD in this language (defaults to the app locale). */}
        <Field label={t("outputLanguage")}>
          <select
            value={outputLang}
            onChange={(e) => setOutputLang(isLocale(e.target.value) ? e.target.value : "en")}
            className={`${INP} uppercase`}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t("describeNeed")} className="mt-2">
        <textarea
          value={needText}
          onChange={(e) => setNeedText(e.target.value)}
          rows={4}
          placeholder={t("needPlaceholder")}
          className={INP}
        />
      </Field>
      <Field label={t("codebaseLabel")} className="mt-2">
        <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder={t("codebasePlaceholder")} className={INP} />
      </Field>

      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate}
        className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {generating ? buildProgress || t("generating") : t("generateJd")}
      </button>
      {generating ? <p className="mt-1.5 text-sm text-steel">{t("generatingNote")}</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {displayResult ? (
        // Keyed by template so switching the format after generation re-renders
        // the AI output through the newly chosen template. The key change remounts
        // this component and reformats the editable body — which is why a switch
        // over hand-edited text is gated by the confirm above (onEditedChange feeds
        // resultDirty). See the template-switch contract in docs/JD_LIFECYCLE.md.
        <JdBuilderResult key={templateId} result={displayResult} title={title.trim()} company={company.trim()} onSaved={onSaved} onEditedChange={setResultDirty} />
      ) : null}

      {manageOpen ? <JdTemplateManager onClose={() => setManageOpen(false)} onChanged={loadTemplates} /> : null}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}
