import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlantUml } from "@/app/_components/puml/PlantUml";
import { WorkspaceShell } from "@/app/features/WorkspaceNav";
import { PipelineExplorer } from "./PipelineExplorer";

// Renders the real architecture sources straight from docs/diagrams/*.puml
// (read server-side, so the page always reflects the committed source) through
// our own PlantUML renderer — the stress test for big, nested-package diagrams.

export const dynamic = "force-dynamic";

// docs/diagrams/*.puml are committed build artifacts: in production they never
// change at runtime, so reading them from disk on every (force-dynamic) request
// is pure repeated I/O. Cache each read by filename in module scope. In
// development we always re-read so edits to the .puml sources show up live
// without a restart — preserving the "always reflects the committed source"
// behavior the page comment describes. A failed read is never cached, so a file
// that appears later still recovers.
const sourceCache = new Map<string, string>();

function readDiagramSource(file: string): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const cached = sourceCache.get(file);
    if (cached !== undefined) return cached;
  }
  let source: string;
  try {
    source = readFileSync(join(process.cwd(), "docs", "diagrams", file), "utf8");
  } catch {
    return ""; // missing/unreadable — the page shows "Could not read …"; don't cache it
  }
  if (isProd) sourceCache.set(file, source);
  return source;
}

const DIAGRAMS: { file: string; label: string; blurb: string; featured?: boolean }[] = [
  {
    file: "15-automated-pipeline-tobe.puml",
    label: "live pipeline — JD → hire",
    blurb:
      "The end-to-end pipeline from authoring a job description to a hired candidate, with each wired step grouped under its simulation phase (Design JD · Source · Intake · Screen · Interview · Offer · Hired). All five gap directions are wired — click any step to open its real implementation: which UI module calls which function, against which data tables.",
    featured: true,
  },
  {
    file: "01-system-architecture-v1.puml",
    label: "v1 — original CV analysis",
    blurb: "Where it began: one CV → at most one JD → a single Gemini call.",
  },
  {
    file: "02-system-architecture-v2.puml",
    label: "v2 — matching platform (now built)",
    blurb:
      "The matching platform now powering the app: job-ad ingestion, archetype routing, the KO→score matching engine (deterministic, Claude-CLI reasoning), and the taxonomy graph. The embedding/semantic bridge is still planned.",
  },
];

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-meta text-steel">
      <li className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-5 rounded border" style={{ background: "#e9f1e2", borderColor: "#5d7a57" }} />
        live / automated
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-5 rounded border" style={{ background: "#fbece8", borderColor: "#d65a4a" }} />
        human gate (kept by design)
      </li>
      <li className="flex items-center gap-2">
        <span
          className="inline-block h-3.5 w-5 rounded border border-dashed"
          style={{ background: "#f4f2ec", borderColor: "#8c8779" }}
        />
        remaining gap (shown inside a step)
      </li>
    </ul>
  );
}

export default function DiagramsPage() {
  const items = DIAGRAMS.map((d) => ({ ...d, source: readDiagramSource(d.file) }));

  return (
    <WorkspaceShell active="about">
      <header className="border-b border-stone-200 pb-5">
        <p className="text-meta uppercase text-coral">Architecture</p>
        <h1 className="mt-1 font-serif text-display text-ink">System diagrams</h1>
        <p className="mt-2 max-w-3xl text-body text-steel">
          The PlantUML sources in <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">docs/diagrams/</code>{" "}
          rendered live by our own renderer — same component-diagram syntax, our styling. The{" "}
          <span className="font-medium text-moss">tinted</span> elements are v2-new
          (<code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">{"<<v2>>"}</code>); dashed arrows are
          optional or asynchronous links.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {items.map((it) => (
          <section key={it.file} className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-h2 text-ink">{it.label}</h2>
              <code className="text-meta text-steel">docs/diagrams/{it.file}</code>
            </div>
            <p className="mt-1 max-w-3xl text-base leading-7 text-steel">{it.blurb}</p>
            {it.featured ? <Legend /> : null}
            {it.source ? (
              it.featured ? (
                <PipelineExplorer source={it.source} />
              ) : (
                <PlantUml source={it.source} scale="natural" className="mt-4" expandable />
              )
            ) : (
              <p className="mt-4 text-sm text-coral">Could not read {it.file}.</p>
            )}
          </section>
        ))}
      </div>
    </WorkspaceShell>
  );
}
