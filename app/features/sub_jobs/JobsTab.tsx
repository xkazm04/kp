"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SearchX, X } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import {
  FAMILY_LABEL,
  FAMILIES,
  SENIORITIES,
  MODES,
} from "./JobsTypes";
import type { Job, Stats } from "./JobsTypes";
import { Chip, Select } from "./JobsShared";
import { JobsTableFrame, JobsTableSkeleton } from "./JobsTable";
import { JobRow } from "./JobRow";
import { JobPostingModal } from "./JobPostingModal";

export function JobsTab() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [openJob, setOpenJob] = useState<Job | null>(null);

  const [roleFamily, setRoleFamily] = useState("");
  const [seniority, setSeniority] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [entryOnly, setEntryOnly] = useState(false);
  const [q, setQ] = useState("");

  // Deep link from the Pipeline (?tab=jobs&job=<id>): auto-open that job's posting.
  const search = useSearchParams();
  const jobParam = search.get("job");
  useEffect(() => {
    if (jobParam && jobs) {
      const match = jobs.find((j) => j.id === jobParam);
      if (match) setOpenJob(match);
    }
  }, [jobParam, jobs]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (roleFamily) params.set("roleFamily", roleFamily);
    if (seniority) params.set("seniority", seniority);
    if (workMode) params.set("workMode", workMode);
    if (entryOnly) params.set("entryEligible", "true");
    if (q.trim()) params.set("q", q.trim());
    const handle = setTimeout(() => {
      setFetching(true);
      setError(null);
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
        })
        .finally(() => {
          if (!cancelled) setFetching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [roleFamily, seniority, workMode, entryOnly, q]);

  const anyFilter = Boolean(roleFamily || seniority || workMode || entryOnly || q.trim());
  const clearAll = () => {
    setRoleFamily("");
    setSeniority("");
    setWorkMode("");
    setEntryOnly(false);
    setQ("");
  };

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
            value={`${stats.entryEligible} (${formatPercent((stats.entryEligible / Math.max(stats.total, 1)) * 100)})`}
            tone="green"
          />
          {Object.entries(stats.byRoleFamily).map(([k, v]) => (
            <Chip key={k} label={FAMILY_LABEL[k] ?? k} value={v} />
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={roleFamily} onChange={setRoleFamily} all="All families" label="Filter by role family">
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {FAMILY_LABEL[f] ?? f}
            </option>
          ))}
        </Select>
        <Select value={seniority} onChange={setSeniority} all="All seniority" label="Filter by seniority">
          {SENIORITIES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </Select>
        <Select value={workMode} onChange={setWorkMode} all="All modes" label="Filter by work mode">
          {MODES.map((m) => (
            <option key={m} value={m} className="capitalize">
              {m}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-base text-ink">
          <input
            type="checkbox"
            checked={entryOnly}
            onChange={(e) => setEntryOnly(e.target.checked)}
            className="h-4 w-4 accent-coral"
          />
          Entry-eligible only
        </label>
        <label htmlFor="jobs-search" className="sr-only">
          Search jobs by title or company
        </label>
        <input
          id="jobs-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or company…"
          className="focus-ring h-10 flex-1 min-w-[180px] rounded-md border border-stone-200 px-3 text-base"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-base" aria-live="polite">
        {jobs && stats ? (
          <span className="text-steel">
            Showing <span className="font-semibold tabular-nums text-ink">{jobs.length}</span> of{" "}
            <span className="font-semibold tabular-nums text-ink">{stats.total}</span> roles
          </span>
        ) : null}
        {anyFilter ? (
          <button
            type="button"
            onClick={clearAll}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
          >
            <X size={12} aria-hidden /> Clear all
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
        ) : jobs == null ? (
          <JobsTableFrame>
            <JobsTableSkeleton />
          </JobsTableFrame>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-12 text-center">
            <SearchX className="h-8 w-8 text-steel" aria-hidden />
            <div>
              <p className="text-base font-semibold text-ink">No roles match these filters</p>
              <p className="mt-1 text-base text-steel">Try widening your search or clearing the filters.</p>
            </div>
            {anyFilter ? (
              <button
                type="button"
                onClick={clearAll}
                className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-base font-semibold text-ink hover:bg-stone-50"
              >
                <X size={14} aria-hidden /> Clear all filters
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className={
              fetching
                ? "animate-pulse opacity-60 transition-opacity motion-reduce:animate-none"
                : "transition-opacity"
            }
            aria-busy={fetching}
          >
            <JobsTableFrame>
              <tbody className="divide-y divide-stone-200">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => setOpenJob(job)} />
                ))}
              </tbody>
            </JobsTableFrame>
          </div>
        )}
      </div>

      {openJob ? <JobPostingModal job={openJob} onClose={() => setOpenJob(null)} /> : null}
    </section>
  );
}
