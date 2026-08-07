// State + handlers for JdsBuilder.tsx — extracted verbatim (no behaviour change)
// so the builder file stays under the 200-line split threshold. Owns: the form
// fields (title/company/seniority/family/need/repo/output-lang), the template
// picker, the live advisory lint, the backgrounded Generate flow, and the
// Save-as-draft flow.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { builderLintFindings, type GeneratePrefill } from "./jdsLibrary";
import { fetchTemplates, type Template } from "@/app/features/shared/renderTemplate";
import { validateJdBuildInput, validateJdFields } from "@/app/_lib/jd-limits";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { ROLE_FAMILY_SLUGS } from "@/app/_lib/role-families";
import { readClientOrgName } from "@/app/_lib/org-settings";

export const SENIORITIES = ["junior", "medior", "senior", "lead"];
// Role-family slugs (canonical; the display label comes from the enums catalog).
export const FAMILIES = ROLE_FAMILY_SLUGS;

// The JD output languages that are honest end-to-end: the pipeline's design chain
// + market-salary CLI localize narrative only for en + cs (pipeline/jobfit/i18n.py
// normalize_lang), and runJdBuild's composeMarkdown scaffolding table has en/cs
// only. de/fr would silently yield an English JD, so they are offered as
// unavailable rather than selectable. Mirror this list if the pipeline gains a
// language.
export const JD_OUTPUT_LANGS = ["en", "cs"] as const;
export function isOutputLang(value: unknown): value is (typeof JD_OUTPUT_LANGS)[number] {
  return typeof value === "string" && (JD_OUTPUT_LANGS as readonly string[]).includes(value);
}

export function useJdBuilderLogic({ onSaved, prefill }: { onSaved: () => void; prefill?: GeneratePrefill }) {
  const t = useTranslations("library.builder");
  const enumLabel = useEnumLabel();
  // API failures resolve from the machine `code`, never the server's English
  // `error` string — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
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
        throw new Error(errMsg(p, t("generateFailedStatus", { status: r.status })));
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
        throw new Error(errMsg(p, t("saveDraftFailedStatus", { status: r.status })));
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

  return {
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
  };
}
