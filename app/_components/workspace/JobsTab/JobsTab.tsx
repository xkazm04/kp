"use client";

import { useEffect, useState } from "react";

type JobRequirement = { skill: string; termId?: string | null; kind: string; hardness: string };
type JobEntryProfile = {
  isEntryEligible: boolean;
  graduateFriendliness: number;
  reinterpretedMusts: string[];
  trainableGaps: string[];
  rationale?: string;
};
type Job = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  employmentType?: string | null;
  seniority?: string;
  roleFamily?: string;
  languages?: string[];
  minYearsExperience?: number | null;
  minEducation?: string | null;
  description?: string;
  requirements?: JobRequirement[];
  detectedSkills?: string[];
  salaryBand?: number[];
  entryProfile?: JobEntryProfile | null;
};
type Stats = {
  total: number;
  entryEligible: number;
  byRoleFamily: Record<string, number>;
  bySeniority: Record<string, number>;
  byWorkMode: Record<string, number>;
};

const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};
const FAMILIES = ["software_engineering", "data_ai", "product_project"];
const SENIORITIES = ["junior", "medior", "senior", "lead"];
const MODES = ["remote", "hybrid", "onsite"];

export function JobsTab() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [entryOnly, setEntryOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (roleFamily) params.set("roleFamily", roleFamily);
    if (seniority) params.set("seniority", seniority);
    if (workMode) params.set("workMode", workMode);
    if (entryOnly) params.set("entryEligible", "true");
    if (q.trim()) params.set("q", q.trim());
    const handle = setTimeout(() => {
      fetch(`/api/jobs?${params.toString()}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Load failed (${r.status}).`);
          return r.json();
        })
        .then((payload) => {
          if (cancelled) return;
          setJobs((payload.jobs as Job[]) ?? []);
          setStats((payload.stats as Stats) ?? null);
        })
        .catch((caught) => {
          if (cancelled) return;
          setError(caught instanceof Error ? caught.message : "Load failed.");
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [roleFamily, seniority, workMode, entryOnly, q]);

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <header className="border-b border-stone-200 pb-4">
        <p className="text-meta uppercase text-coral">Workspace</p>
        <h2 className="mt-1 font-serif text-display text-ink">Job corpus</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">
          The structured job database the matching engine runs against. Each ad is parsed into
          must / nice-to-have requirements (each tagged prerequisite vs learnable) and carries a
          precomputed <strong>graduate lens</strong> — the entry-eligibility flag and reinterpreted
          requirements that let student profiles be compared against experience-oriented postings.
        </p>
      </header>

      {stats ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip label="Total" value={stats.total} />
          <Chip
            label="Entry-eligible"
            value={`${stats.entryEligible} (${Math.round((stats.entryEligible / Math.max(stats.total, 1)) * 100)}%)`}
            tone="green"
          />
          {Object.entries(stats.byRoleFamily).map(([k, v]) => (
            <Chip key={k} label={FAMILY_LABEL[k] ?? k} value={v} />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={roleFamily} onChange={setRoleFamily} all="All families">
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {FAMILY_LABEL[f] ?? f}
            </option>
          ))}
        </Select>
        <Select value={seniority} onChange={setSeniority} all="All seniority">
          {SENIORITIES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </Select>
        <Select value={workMode} onChange={setWorkMode} all="All modes">
          {MODES.map((m) => (
            <option key={m} value={m} className="capitalize">
              {m}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={entryOnly}
            onChange={(e) => setEntryOnly(e.target.checked)}
            className="h-4 w-4 accent-coral"
          />
          Entry-eligible only
        </label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or company…"
          className="focus-ring h-10 flex-1 min-w-[180px] rounded-md border border-stone-200 px-3 text-sm"
        />
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : jobs == null ? (
          <p className="text-sm text-steel">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="rounded-md bg-paper p-4 text-sm text-steel">No jobs match these filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-200">
              <thead className="bg-paper">
                <tr>
                  <Th>Role</Th>
                  <Th>Location</Th>
                  <Th>Mode</Th>
                  <Th>Seniority</Th>
                  <Th>Family</Th>
                  <Th>Salary (CZK/mo)</Th>
                  <Th>Entry</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {jobs.map((job) => {
                  const isOpen = expanded === job.id;
                  return (
                    <JobRow
                      key={job.id}
                      job={job}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : job.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function JobRow({ job, isOpen, onToggle }: { job: Job; isOpen: boolean; onToggle: () => void }) {
  const ep = job.entryProfile;
  return (
    <>
      <tr className="cursor-pointer hover:bg-paper/60" onClick={onToggle}>
        <Td>
          <span className="font-medium text-ink">{job.title}</span>
          <span className="block text-xs text-steel">{job.company ?? "—"}</span>
        </Td>
        <Td>{job.location ?? "—"}</Td>
        <Td className="capitalize">{job.workMode ?? "—"}</Td>
        <Td className="capitalize">{job.seniority ?? "—"}</Td>
        <Td>{FAMILY_LABEL[job.roleFamily ?? ""] ?? job.roleFamily ?? "—"}</Td>
        <Td>{formatBand(job.salaryBand)}</Td>
        <Td>
          {ep?.isEntryEligible ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
              ✓ {Math.round((ep.graduateFriendliness ?? 0) * 100)}%
            </span>
          ) : (
            <span className="text-xs text-steel">—</span>
          )}
        </Td>
      </tr>
      {isOpen ? (
        <tr className="bg-paper/40">
          <td colSpan={7} className="px-4 py-4">
            <JobDetail job={job} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function JobDetail({ job }: { job: Job }) {
  const reqs = job.requirements ?? [];
  const musts = reqs.filter((r) => r.kind === "must_have");
  const nices = reqs.filter((r) => r.kind !== "must_have");
  const ep = job.entryProfile;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        {job.description ? <p className="text-sm text-ink">{job.description}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-steel">
          <Meta k="Employment" v={job.employmentType ?? "—"} />
          <Meta k="Min. experience" v={job.minYearsExperience != null ? `${job.minYearsExperience} y` : "—"} />
          <Meta k="Min. education" v={job.minEducation ?? "—"} />
          <Meta k="Languages" v={(job.languages ?? []).join(", ") || "—"} />
        </dl>
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel">Must-have</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {musts.map((r, i) => (
              <ReqChip key={`m${i}`} req={r} />
            ))}
            {musts.length === 0 ? <span className="text-xs text-steel">—</span> : null}
          </div>
          {nices.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-steel">Nice-to-have</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {nices.map((r, i) => (
                  <ReqChip key={`n${i}`} req={r} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-coral">Graduate lens</p>
        <p className="mt-1 text-sm text-ink">
          {ep?.isEntryEligible ? "Open to early-career candidates" : "Experienced role"}
          {ep ? ` · friendliness ${Math.round((ep.graduateFriendliness ?? 0) * 100)}%` : ""}
        </p>
        {ep?.rationale ? <p className="mt-1 text-xs text-steel">{ep.rationale}</p> : null}
        {ep?.reinterpretedMusts?.length ? (
          <div className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-steel">
              Requirements, reframed for a graduate
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-ink">
              {ep.reinterpretedMusts.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {ep?.trainableGaps?.length ? (
          <p className="mt-2 text-xs text-steel">
            <span className="font-semibold">Trainable on the job:</span> {ep.trainableGaps.join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReqChip({ req }: { req: JobRequirement }) {
  const learnable = req.hardness === "learnable";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
        learnable ? "border-amber-200 bg-amber-50 text-amber-800" : "border-stone-300 bg-white text-ink"
      }`}
      title={`${req.kind} · ${req.hardness}${req.termId ? ` · ${req.termId}` : ""}`}
    >
      {req.skill}
      <span className="text-[10px] uppercase opacity-70">{learnable ? "learnable" : "prereq"}</span>
    </span>
  );
}

function Chip({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "green" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
        tone === "green" ? "border-green-200 bg-green-50 text-green-800" : "border-stone-200 bg-paper text-ink"
      }`}
    >
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

function Select({
  value,
  onChange,
  all,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  all: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="focus-ring h-10 rounded-md border border-stone-200 bg-white px-2 text-sm capitalize text-ink"
    >
      <option value="">{all}</option>
      {children}
    </select>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-steel">{k}</dt>
      <dd className="capitalize text-ink">{v}</dd>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-steel">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-ink ${className}`}>{children}</td>;
}

function formatBand(band?: number[]): string {
  if (!band || band.length < 2) return "—";
  return `${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)}k`;
}
