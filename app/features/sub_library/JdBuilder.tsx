"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Settings2, Sparkles } from "lucide-react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { JdBuilderResult, type JdBuildResult } from "./JdBuilderResult";
import { JdTemplateManager } from "./JdTemplateManager";
import { fetchTemplates, renderTemplate, type Template } from "./render-template";
import { formatSalaryRange } from "@/app/_lib/format";

const SENIORITIES = ["junior", "medior", "senior", "lead"];
const FAMILIES: { v: string; label: string }[] = [
  { v: "software_engineering", label: "Software" },
  { v: "data_ai", label: "Data / AI" },
  { v: "product_project", label: "Product / Project" },
];
const INP = "focus-ring w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-sm";

// AI job-description builder: free-text need (+ optional public GitHub repo for
// dev roles) → our need→design machinery → an editable, publishable JD with a
// web-grounded market-salary analysis.
export function JdBuilder({ onSaved }: { onSaved: () => void }) {
  const { startTask, tasks } = useTasks();
  // Deep-link / simulation prefill (jd* query params) — mirrors MatchTab's pattern.
  const sp = useSearchParams();
  const [title, setTitle] = useState(sp.get("jdTitle") ?? "");
  const [company, setCompany] = useState(sp.get("jdCompany") ?? "");
  const [seniority, setSeniority] = useState(sp.get("jdSeniority") ?? "medior");
  const [roleFamily, setRoleFamily] = useState(sp.get("jdFamily") ?? "software_engineering");
  const [needText, setNeedText] = useState(sp.get("jdNeed") ?? "");
  const [repoUrl, setRepoUrl] = useState("");

  // Template-first authoring: pick a company format, then let AI fill it. An
  // empty templateId means "use the AI's own default formatting".
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [manageOpen, setManageOpen] = useState(false);

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

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const generating = Boolean(taskId) && task?.status !== "succeeded" && task?.status !== "failed";

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
    const s = result.salary;
    const salaryLabel =
      s && s.suggestedMinimum > 0
        ? formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency, period: "mo" })
        : "";
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

  useEffect(() => {
    if (!task) return;
    if (task.status === "succeeded") {
      setResult((task.result as JdBuildResult) ?? null);
      setTaskId(null);
    } else if (task.status === "failed" || task.status === "canceled" || task.status === "interrupted") {
      setError(task.error ?? "Generation failed.");
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskId]);

  const generate = async () => {
    setError(null);
    setResult(null);
    const t = await startTask("jd_build", { title: title.trim(), company: company.trim(), seniority, roleFamily, needText: needText.trim(), repoUrl: repoUrl.trim() });
    if (t) setTaskId(t.id);
    else setError("Couldn't start the build.");
  };

  const canGenerate = title.trim().length > 1 && needText.trim().length > 10 && !generating;

  return (
    <div data-sim="jd-builder" className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={14} /> Generate with AI
      </p>
      <p className="mt-1 text-sm text-steel">
        Pick a company template, describe the need in your own words, and AI fills the template — clarifying the
        need, designing the role (optionally analyzing a public repo for dev roles), and researching market salary.
      </p>

      {/* Step 1: pick the output format. The AI fills whichever template is chosen. */}
      <div className="mt-3 flex items-end gap-2">
        <Field label="Template" className="flex-1">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={INP}>
            <option value="">AI default format (no template)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-steel hover:bg-stone-50"
          title="Create, edit, or delete company templates"
        >
          <Settings2 size={14} /> Manage
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label="Role title *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Platform Engineer" className={INP} />
        </Field>
        <Field label="Company">
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Česká spořitelna" className={INP} />
        </Field>
        <Field label="Seniority">
          <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className={`${INP} capitalize`}>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Field">
          <select value={roleFamily} onChange={(e) => setRoleFamily(e.target.value)} className={INP}>
            {FAMILIES.map((f) => (
              <option key={f.v} value={f.v}>{f.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Describe the need *" className="mt-2">
        <textarea
          value={needText}
          onChange={(e) => setNeedText(e.target.value)}
          rows={4}
          placeholder="What does this person own? What problems will they solve? What does the team look like?"
          className={INP}
        />
      </Field>
      <Field label="Codebase to analyze (public GitHub URL — optional, for dev roles)" className="mt-2">
        <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" className={INP} />
      </Field>

      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate}
        className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {generating ? task?.progressMsg || "Generating…" : "Generate job description"}
      </button>
      {generating ? <p className="mt-1.5 text-sm text-steel">This runs a few AI steps and takes ~1–2 minutes — it keeps going if you navigate away.</p> : null}
      {error ? <p role="alert" className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {displayResult ? (
        // Keyed by template so switching the format after generation re-renders
        // the AI output through the newly chosen template.
        <JdBuilderResult key={templateId} result={displayResult} title={title.trim()} company={company.trim()} onSaved={onSaved} />
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
