"use client";

import { useEffect, useState } from "react";
import { FileText, LayoutTemplate, Settings2 } from "lucide-react";
import { JdBuilderResult, type JdBuildResult } from "./JdBuilderResult";
import { JdTemplateManager } from "./JdTemplateManager";
import { renderTemplate } from "./render-template";
import { salaryBandError } from "@/app/_lib/salary-band";

type Template = { id: string; name: string; body: string; isDefault: boolean };

const SENIORITIES = ["junior", "medior", "senior", "lead"];
const FAMILIES = [
  { v: "software_engineering", label: "Software" },
  { v: "data_ai", label: "Data / AI" },
  { v: "product_project", label: "Product / Project" },
];
const INP = "focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm";
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

// Keyless JD authoring from a company template: pick a format, fill the role,
// render, then save as a draft + publish (the Phase 1 lifecycle). The companion
// to the AI builder — no Gemini key needed.
export function JdTemplates({ onSaved }: { onSaved: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [manageOpen, setManageOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("Česká spořitelna");
  const [seniority, setSeniority] = useState("medior");
  const [roleFamily, setRoleFamily] = useState("software_engineering");
  const [salaryMin, setSalaryMin] = useState(120000);
  const [salaryMax, setSalaryMax] = useState(165000);
  const [responsibilities, setResponsibilities] = useState("");
  const [mustHaves, setMustHaves] = useState("");
  const [niceToHaves, setNiceToHaves] = useState("");

  const [result, setResult] = useState<JdBuildResult | null>(null);
  const [buildKey, setBuildKey] = useState(0);

  const loadTemplates = () =>
    fetch("/api/templates")
      .then((r) => r.json())
      .then((p) => {
        const list = (p.templates as Template[]) ?? [];
        setTemplates(list);
        // Reconcile the selection after every load: a delete, rename, or
        // default change in the manager can drop or reorder the chosen
        // template, leaving templateId pointing at a now-missing id. Left
        // stale, the select silently shows its first option while build()
        // renders from a different (fallback) template. Keep the current
        // id only if it still exists; otherwise fall back to the first.
        setTemplateId((cur) => (list.some((t) => t.id === cur) ? cur : list[0]?.id ?? ""));
      })
      .catch(() => undefined);
  useEffect(() => {
    loadTemplates();
  }, []);

  const build = () => {
    const tpl = templates.find((t) => t.id === templateId) ?? templates[0];
    if (!tpl) return;
    const markdown = renderTemplate(tpl.body, {
      title,
      company,
      seniority,
      salary: `${salaryMin.toLocaleString("cs-CZ")}–${salaryMax.toLocaleString("cs-CZ")} CZK/mo`,
      responsibilities: lines(responsibilities),
      mustHaves: lines(mustHaves),
      niceToHaves: lines(niceToHaves),
    });
    setResult({
      markdown,
      role: {
        title,
        seniority,
        roleFamily,
        mustHaves: lines(mustHaves),
        niceToHaves: lines(niceToHaves),
        responsibilities: lines(responsibilities),
        languages: [],
      },
      salary: { suggestedMinimum: salaryMin, suggestedMaximum: salaryMax, currency: "CZK", confidence: "manual", summary: "Built from a company template." },
    });
    setBuildKey((k) => k + 1);
  };

  // Guard the salary band at the form trust boundary: a backwards (min > max),
  // zero, or negative range would render an impossible band into the JD while
  // ingest silently corrects/drops it — leaving the ad and the matcher disagreeing.
  const salaryError = salaryBandError(salaryMin, salaryMax);
  const canBuild = title.trim().length > 1 && templates.length > 0 && !salaryError;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
          <LayoutTemplate size={14} /> Build from a company template
        </p>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-50"
        >
          <Settings2 size={13} /> Manage templates
        </button>
      </div>
      <p className="mt-1 text-sm text-steel">No AI needed — fill the role and render a branded, publishable JD.</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label="Template">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={INP}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Role title *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Platform Engineer" className={INP} />
        </Field>
        <Field label="Company">
          <input value={company} onChange={(e) => setCompany(e.target.value)} className={INP} />
        </Field>
        <Field label="Seniority">
          <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className={`${INP} capitalize`}>
            {SENIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Field">
          <select value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)} className={INP}>
            {FAMILIES.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Salary band (CZK/mo)">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={1000}
              value={salaryMin}
              onChange={(e) => setSalaryMin(Number(e.target.value) || 0)}
              aria-invalid={Boolean(salaryError)}
              className={INP}
            />
            <span className="text-steel">–</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={salaryMax}
              onChange={(e) => setSalaryMax(Number(e.target.value) || 0)}
              aria-invalid={Boolean(salaryError)}
              className={INP}
            />
          </div>
          {salaryError ? <p role="alert" className="mt-1 text-sm text-red-600">{salaryError}</p> : null}
        </Field>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Field label="Responsibilities (one per line)">
          <textarea value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} rows={4} className={INP} />
        </Field>
        <Field label="Must-haves (one per line)">
          <textarea value={mustHaves} onChange={(e) => setMustHaves(e.target.value)} rows={4} className={INP} />
        </Field>
        <Field label="Nice-to-haves (one per line)">
          <textarea value={niceToHaves} onChange={(e) => setNiceToHaves(e.target.value)} rows={4} className={INP} />
        </Field>
      </div>

      <button
        type="button"
        onClick={build}
        disabled={!canBuild}
        className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        <FileText size={16} /> Render JD from template
      </button>

      {result ? <JdBuilderResult key={buildKey} result={result} title={title.trim()} company={company.trim()} onSaved={onSaved} /> : null}

      {manageOpen ? <JdTemplateManager onClose={() => setManageOpen(false)} onChanged={loadTemplates} /> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}
