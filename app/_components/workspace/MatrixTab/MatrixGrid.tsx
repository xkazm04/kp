"use client";

import Link from "next/link";

export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
};

export type JdRow = {
  slug: string;
  title: string;
  body: string;
  created_at: string;
};

type Cell = {
  slug: string;
  score: number | null;
  roleFamily: string | null;
  seniority: string | null;
};

type CandidateRow = {
  label: string;
  cells: Map<string, Cell[]>;
  unbound: Cell[];
};

export type MatrixGridData = {
  candidates: CandidateRow[];
  orderedJds: JdRow[];
  hasUnbound: boolean;
};

export function buildMatrix(analyses: AnalysisRow[], jds: JdRow[]): MatrixGridData {
  const map = new Map<string, CandidateRow>();
  for (const a of analyses) {
    let row = map.get(a.candidate_label);
    if (!row) {
      row = { label: a.candidate_label, cells: new Map(), unbound: [] };
      map.set(a.candidate_label, row);
    }
    const cell: Cell = {
      slug: a.slug,
      score: a.score,
      roleFamily: a.role_family,
      seniority: a.seniority,
    };
    if (a.jd_slug) {
      const list = row.cells.get(a.jd_slug) ?? [];
      list.push(cell);
      row.cells.set(a.jd_slug, list);
    } else {
      row.unbound.push(cell);
    }
  }
  const candidates = Array.from(map.values()).sort(
    (a, b) => b.cells.size - a.cells.size || a.label.localeCompare(b.label)
  );
  const usedJdSlugs = new Set<string>();
  for (const c of candidates) for (const slug of c.cells.keys()) usedJdSlugs.add(slug);
  const orderedJds = jds.filter((jd) => usedJdSlugs.has(jd.slug));
  const hasUnbound = candidates.some((c) => c.unbound.length > 0);
  return { candidates, orderedJds, hasUnbound };
}

export function MatrixGrid({ grid }: { grid: MatrixGridData }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200">
      <table className="min-w-full divide-y divide-stone-200">
        <thead className="bg-paper">
          <tr>
            <Th sticky>Candidate</Th>
            {grid.orderedJds.map((jd) => (
              <Th key={jd.slug} title={jd.title}>
                <Link
                  href={`/jds/${jd.slug}`}
                  className="font-medium text-ink hover:text-coral hover:underline"
                >
                  {jd.title.length > 32 ? `${jd.title.slice(0, 30)}…` : jd.title}
                </Link>
                <span className="ml-2 font-mono text-[10px] text-coral">{jd.slug}</span>
              </Th>
            ))}
            {grid.hasUnbound ? <Th>(no JD)</Th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {grid.candidates.map((candidate) => (
            <tr key={candidate.label} className="hover:bg-paper/60">
              <Td sticky>
                <span className="font-medium text-ink">{candidate.label}</span>
              </Td>
              {grid.orderedJds.map((jd) => (
                <MatrixCell key={jd.slug} cells={candidate.cells.get(jd.slug) ?? []} />
              ))}
              {grid.hasUnbound ? <MatrixCell cells={candidate.unbound} muted /> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCell({ cells, muted = false }: { cells: Cell[]; muted?: boolean }) {
  if (cells.length === 0) return <Td>—</Td>;
  const latest = cells[0];
  const tone = scoreTone(latest.score);
  return (
    <Td className={muted ? "opacity-80" : ""}>
      <Link
        href={`/history/${latest.slug}`}
        className={`focus-ring inline-flex min-w-12 items-center justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${tone}`}
        title={`${latest.roleFamily ?? "?"} · ${latest.seniority ?? "?"} · open ${latest.slug}`}
      >
        {latest.score ?? "—"}
      </Link>
      {cells.length > 1 ? (
        <span className="ml-2 text-xs text-steel">+{cells.length - 1}</span>
      ) : null}
    </Td>
  );
}

function scoreTone(score: number | null): string {
  if (score == null) return "bg-stone-100 text-ink";
  if (score >= 85) return "bg-moss/30 text-ink";
  if (score >= 70) return "bg-limewash text-ink";
  if (score >= 55) return "bg-paper text-ink";
  return "bg-coral/15 text-ink";
}

function Th({
  children,
  sticky = false,
  title,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  title?: string;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={`px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-steel ${
        sticky ? "sticky left-0 z-10 bg-paper" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  sticky = false,
}: {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <td
      className={`px-3 py-3 text-sm text-ink ${className} ${
        sticky ? "sticky left-0 z-10 bg-white" : ""
      }`}
    >
      {children}
    </td>
  );
}
