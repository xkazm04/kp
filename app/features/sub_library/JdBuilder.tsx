"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, Loader2, Save, Settings2, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/locales";
import { builderLintFindings, type GeneratePrefill } from "./jd-library";
import { JdLintPanel } from "./JdLintPanel";
import { JdTemplateManager } from "./JdTemplateManager";
import { fetchTemplates, type Template } from "./render-template";
import { validateJdBuildInput, validateJdFields } from "@/app/_lib/jd-limits";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import { readClientOrgName } from "@/app/_lib/org-settings";
import { RichTextEditor } from "@/app/_components/RichTextEditor";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";

const SENIORITIES = ["junior", "medior", "senior", "lead"];
// Role-family slugs (canonical; the display label comes from the enums catalog).
const FAMILIES = ROLE_FAMILY_SLUGS;

// The JD output languages that are honest end-to-end: the pipeline's design chain
// + market-salary CLI localize narrative only for en + cs (pipeline/jobfit/i18n.py
// normalize_lang), and runJdBuild's composeMarkdown scaffolding table has en/cs
// only. de/fr would silently yield an English JD, so they are offered as
// unavailable rather than selectable. Mirror this list if the pipeline gains a
// language.
const JD_OUTPUT_LANGS = ["en", "cs"] as const;
function isOutputLang(value: unknown): value is (typeof JD_OUTPUT_LANGS)[number] {
  return typeof value === "string" && (JD_OUTPUT_LANGS as readonly string[]).includes(value);
}

// AI job-description builder. "Generate" opens a checklist (description / market
// research / interview case) and hands the work to the detached jd_build task via
// POST /api/jds/generate: the JD appears in the Ledger immediately as "Analyzing"
// and fills in server-side, so it completes even if the recruiter navigates away.
// "Save as draft" still persists the form's own input straight to the library
// without any AI round-trip.
export function JdBuilder({ onSaved, prefill }: { onSaved: () => void; prefill?: GeneratePrefill }) {
  const t = useTranslations("library.builder");
  const enumLabel = useEnumLabel();
  // Deep-link / simulation prefill (jd* query params) — mirrors MatchTab's pattern.
  // A `prefill` prop (Duplicate → Generate) takes precedence over the query params;
  // the component remounts per duplicate, so these mount-time seeds re-read it.
  const sp = useSearchParams();
  const [title, setTitle] = useState(prefill?.title ?? sp.get("jdTitle") ?? "");
  // Company defaults to the Duplicate source, then a deep-link prefill (?jdCompany),
  // then the organization name (Settings → Organization). Lazy init reads the org
  // cookie once on first render; the user's edits win after.
  const [company, setCompany] = useState(() => prefill?.company ?? sp.get("jdCompany") ?? readClientOrgName());
  const [seniority, setSeniority] = useState(prefill?.seniority ?? sp.get("jdSeniority") ?? "medior");
  const [roleFamily, setRoleFamily] = useState(prefill?.roleFamily ?? sp.get("jdFamily") ?? "software_engineering");
  const [needText, setNeedText] = useState(prefill?.need ?? sp.get("jdNeed") ?? "");
  const [repoUrl, setRepoUrl] = useState("");
  // JDL5 — the generated JD's output language, defaulting to the active locale
  // (a Czech-market recruiter gets a Czech JD without hand-translating).
  //
  // HONESTY (Direction 2): only en/cs are true end-to-end output languages. The
  // pipeline's normalize_lang (pipeline/jobfit/i18n.py) supports en + cs ONLY —
  // a de/fr build would generate the ROLE CONTENT in English regardless, so
  // offering de/fr as if selectable was a silent English fallback. The selector
  // now marks de/fr unavailable and the default is clamped to a supported code,
  // so a de/fr app locale doesn't silently produce an English JD.
  const appLocale = useLocale();
  const [outputLang, setOutputLang] = useState(isOutputLang(appLocale) ? appLocale : "en");

  // Template-first authoring: pick a company format, then let AI fill it. An empty
  // templateId means "use the AI's own default formatting". The build renders
  // through the chosen template server-side (render-template.ts).
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = () =>
    fetchTemplates().then((list) => {
      setTemplates(list);
      // Keep the current selection if it still exists; else default to the marked
      // default, else the first (matches JdTemplates' reconciliation).
      setTemplateId((cur) => (list.some((tp) => tp.id === cur) ? cur : list.find((tp) => tp.isDefault)?.id ?? list[0]?.id ?? ""));
    });
  useEffect(() => {
    loadTemplates();
  }, []);

  // Field = Software gates the "Codebase to analyze" input — public-repo enrichment
  // is a dev-role feature, so it's shown AND submitted only for software roles.
  const isSoftware = roleFamily === "software_engineering";
  // Field options sorted by display name ascending (the raw slug order is grouped
  // by domain, not alphabetical).
  const familyOptions = useMemo(
    () => FAMILIES.map((f) => ({ value: f, label: enumLabel("family", f) })).sort((a, b) => a.label.localeCompare(b.label)),
    [enumLabel]
  );

  // ── Generate: the backgrounded, checklist-driven AI build ──────────────────
  const [options, setOptions] = useState({ description: true, marketResearch: true, caseDesign: false });

  // ── Advisory specificity/inclusivity lint (jd-lint, live on the editor body) ──
  // Debounced ~400ms so it recomputes off the keystroke path; ADVISORY only —
  // never gates Generate or Save-as-draft. The panel below hides at zero findings.
  const [lintFindings, setLintFindings] = useState<ReturnType<typeof builderLintFindings>>([]);
  const marketResearch = options.marketResearch;
  useEffect(() => {
    const id = setTimeout(() => setLintFindings(builderLintFindings(needText, { marketResearch })), 400);
    return () => clearTimeout(id);
  }, [needText, marketResearch]);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const queuedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (queuedTimer.current) clearTimeout(queuedTimer.current); }, []);

  const anyOption = options.description || options.marketResearch || options.caseDesign;
  // A role (for the description and/or the case) needs a real need; market research
  // alone only needs a title — same contract the generate route + handler enforce.
  const needsNeed = options.description || options.caseDesign;
  const inputOk = needsNeed ? validateJdBuildInput(title, needText).ok : title.trim().length >= 2;
  const canStart = anyOption && inputOk && !submitting;

  const runGenerate = async () => {
    if (!canStart) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/jds/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim(),
          seniority,
          roleFamily,
          needText: needText.trim(),
          repoUrl: isSoftware ? repoUrl.trim() : "",
          lang: outputLang,
          templateId,
          options,
        }),
      });
      // The generate route is operator-gated (a paid AI run) — surface the refusal
      // honestly rather than a generic "generation failed".
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        throw new Error(p.error ?? t("generateFailedStatus", { status: r.status }));
      }
      // The JD now lives in the Ledger as "Analyzing" and fills in server-side.
      // Clear the role-specific inputs so the next role starts fresh (reusable
      // company/seniority/field/template/language stay), reload the Ledger, and
      // show a transient confirmation.
      setChecklistOpen(false);
      setTitle("");
      setNeedText("");
      setRepoUrl("");
      onSaved();
      setQueued(true);
      if (queuedTimer.current) clearTimeout(queuedTimer.current);
      queuedTimer.current = setTimeout(() => setQueued(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Save as draft: persist the form's own input, no AI round-trip ──────────
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const draftSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (draftSavedTimer.current) clearTimeout(draftSavedTimer.current); }, []);

  const saveDraft = async () => {
    // Same validator + wording as POST /api/jds, so the gate fails fast with the
    // identical message instead of a round-trip 400. The "Describe the need" body
    // (a full markdown editor) becomes the JD body.
    const fields = validateJdFields(title, needText);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    setSavingDraft(true);
    setError(null);
    setDraftSaved(false);
    try {
      const r = await fetch("/api/jds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: fields.title, body: fields.body }),
      });
      // POST /api/jds is operator-gated too — same honest refusal line.
      if (r.status === 401 || r.status === 403) throw new Error(t("notPermitted"));
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        throw new Error(p.error ?? t("saveDraftFailedStatus", { status: r.status }));
      }
      onSaved();
      setDraftSaved(true);
      if (draftSavedTimer.current) clearTimeout(draftSavedTimer.current);
      draftSavedTimer.current = setTimeout(() => setDraftSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveDraftFailed"));
    } finally {
      setSavingDraft(false);
    }
  };

  const canSaveDraft = validateJdFields(title, needText).ok && !savingDraft && !submitting;

  return (
    <div data-sim="jd-builder" className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
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
            size="sm"
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
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-steel hover:bg-stone-50"
          title={t("manageTitle")}
        >
          <Settings2 size={14} /> {t("manage")}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label={t("roleTitle")}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("roleTitlePlaceholder")} sizeVariant="sm" />
        </Field>
        <Field label={t("company")}>
          <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("companyPlaceholder")} sizeVariant="sm" />
        </Field>
        <Field label={t("seniority")}>
          <Select
            ariaLabel={t("seniority")}
            value={seniority}
            onChange={setSeniority}
            size="sm"
            className="w-full"
            options={SENIORITIES.map((s) => ({ value: s, label: enumLabel("seniority", s) }))}
          />
        </Field>
        <Field label={t("field")}>
          <Select
            ariaLabel={t("field")}
            value={roleFamily}
            onChange={setRoleFamily}
            size="sm"
            className="w-full"
            searchable
            options={familyOptions}
          />
        </Field>
        {/* JDL5 — generate the JD in this language (defaults to the app locale).
            Only en/cs are honest end-to-end (see the outputLang note above); de/fr
            render disabled so the recruiter never silently gets an English JD. */}
        <Field label={t("outputLanguage")}>
          <Select
            ariaLabel={t("outputLanguage")}
            value={outputLang}
            onChange={(v) => setOutputLang(isOutputLang(v) ? v : "en")}
            size="sm"
            className="w-full"
            options={LOCALES.map((l) =>
              isOutputLang(l)
                ? { value: l, label: l.toUpperCase() }
                : { value: l, label: t("outputLangUnavailable", { lang: l.toUpperCase() }), disabled: true }
            )}
          />
        </Field>
      </div>

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
        {/* Generate → checklist popover → backgrounded build. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setChecklistOpen((v) => !v)}
            aria-expanded={checklistOpen}
            aria-haspopup="dialog"
            disabled={submitting}
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {t("generateJd")}
            <ChevronDown size={15} aria-hidden className={`transition-transform ${checklistOpen ? "rotate-180" : ""}`} />
          </button>
          {checklistOpen ? (
            <>
              {/* Click-away backdrop. */}
              <button type="button" aria-hidden tabIndex={-1} onClick={() => setChecklistOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div
                role="dialog"
                aria-label={t("checklistTitle")}
                className="animate-fade-in absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-stone-200 bg-white p-3 shadow-panel"
              >
                <p className="text-meta uppercase tracking-wide text-steel">{t("checklistTitle")}</p>
                <div className="mt-2 space-y-0.5">
                  <OptionRow checked={options.description} onChange={(v) => setOptions((o) => ({ ...o, description: v }))} label={t("optDescription")} hint={t("optDescriptionHint")} />
                  <OptionRow checked={options.marketResearch} onChange={(v) => setOptions((o) => ({ ...o, marketResearch: v }))} label={t("optMarket")} hint={t("optMarketHint")} />
                  <OptionRow checked={options.caseDesign} onChange={(v) => setOptions((o) => ({ ...o, caseDesign: v }))} label={t("optCase")} hint={t("optCaseHint")} />
                </div>
                <p className="mt-2 border-t border-stone-200 pt-2 text-sm text-steel">{t("checklistHint")}</p>
                {!anyOption ? (
                  <p className="mt-1.5 text-sm text-coral">{t("pickAtLeastOne")}</p>
                ) : !inputOk ? (
                  <p className="mt-1.5 text-sm text-coral">{t("needMoreInput")}</p>
                ) : null}
                <button
                  type="button"
                  onClick={runGenerate}
                  disabled={!canStart}
                  className="focus-ring mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {t("startAnalysis")}
                </button>
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={saveDraft}
          disabled={!canSaveDraft}
          title={t("saveDraft")}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-50"
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

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}

// One checklist row: a checkbox + a bold label and a one-line explanation of what
// that step produces.
function OptionRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-stone-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-coral"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-sm text-steel">{hint}</span>
      </span>
    </label>
  );
}
