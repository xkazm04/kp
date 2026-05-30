"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { JdBuilderResult, type JdBuildResult } from "./JdBuilderResult";

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
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [seniority, setSeniority] = useState("medior");
  const [roleFamily, setRoleFamily] = useState("software_engineering");
  const [needText, setNeedText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<JdBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const generating = Boolean(taskId) && task?.status !== "succeeded" && task?.status !== "failed";

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
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={14} /> Generate with AI
      </p>
      <p className="mt-1 text-sm text-steel">
        Describe the need in your own words. We clarify it, design the role (optionally analyzing a public repo for dev
        roles), and research the market salary on the web.
      </p>

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
      {error ? <p className="mt-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

      {result ? <JdBuilderResult result={result} title={title.trim()} onSaved={onSaved} /> : null}

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
