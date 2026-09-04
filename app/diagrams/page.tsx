import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { isOperator } from "@/app/_lib/auth/require-operator";
import { EYEBROW, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { PlantUml } from "@/app/_components/puml/PlantUml";
import { DIAGRAM_STATUS_TOKENS } from "@/app/_components/puml/constants";
import { WorkspaceShell } from "@/app/features/shell/WorkspaceNav";
import { PipelineExplorer } from "./PipelineExplorer";
import { readDiagramSource } from "./readDiagramSource";

// Renders per-request under the dynamic-locale layout and builds heavy PlantUML
// SVGs from disk on demand — there is no useful static shell, so Block it under
// Cache Components (equivalent to its previous force-dynamic behavior).
export const instant = false;

// Renders the real architecture sources straight from docs/diagrams/*.puml
// (read server-side, so the page always reflects the committed source) through
// our own PlantUML renderer — the stress test for big, nested-package diagrams.
// The on-disk read + module-scope cache live in ./readDiagramSource; those .puml
// files reach the standalone production runtime via next.config.ts's
// `outputFileTracingIncludes` for the /diagrams route.

// bug-ui-scan-2026-07-09 (architecture-diagrams #3): the user-facing label/blurb
// for each diagram live in messages/*.json (items.<key>.*); only the on-disk file
// name and layout flags stay here.
const DIAGRAMS: { file: string; key: "tobe" | "v1" | "v2"; featured?: boolean }[] = [
  { file: "15-automated-pipeline-tobe.puml", key: "tobe", featured: true },
  { file: "01-system-architecture-v1.puml", key: "v1" },
  { file: "02-system-architecture-v2.puml", key: "v2" },
];

function Legend({ live, gate, gap }: { live: string; gate: string; gap: string }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-meta text-steel">
      <li className="flex items-center gap-2">
        <span
          className="inline-block h-3.5 w-5 rounded border"
          style={{ background: DIAGRAM_STATUS_TOKENS.live.fill, borderColor: DIAGRAM_STATUS_TOKENS.live.stroke }}
        />
        {live}
      </li>
      <li className="flex items-center gap-2">
        <span
          className="inline-block h-3.5 w-5 rounded border"
          style={{ background: DIAGRAM_STATUS_TOKENS.gate.fill, borderColor: DIAGRAM_STATUS_TOKENS.gate.stroke }}
        />
        {gate}
      </li>
      <li className="flex items-center gap-2">
        <span
          className="inline-block h-3.5 w-5 rounded border border-dashed"
          style={{ background: DIAGRAM_STATUS_TOKENS.gap.fill, borderColor: DIAGRAM_STATUS_TOKENS.gap.stroke }}
        />
        {gap}
      </li>
    </ul>
  );
}

export default async function DiagramsPage() {
  // INTERNAL SURFACE (/perfect wave 21b). This explorer draws the repository's own
  // module paths, the endpoints behind each step and an explicit off-spec admission
  // ("the runtime extractor still calls Gemini"). That is an engineering artifact for
  // the people who run this install, not product copy for anyone holding a valid
  // cookie — and a demo cookie IS a valid session. Gate it exactly as the control
  // room does: `isOperator()` (open dev -> true; a demo-workspace session -> false),
  // answering the same 404 an unknown route does rather than confirming it exists.
  // The About tab's link is hidden for the same seats.
  if (!(await isOperator())) notFound();
  // bug-ui-scan-2026-07-09 (architecture-diagrams #3): page chrome / legend /
  // blurbs are localized; the diagram BODIES stay code identifiers (untranslated).
  const t = await getTranslations("diagrams");
  const items = DIAGRAMS.map((d) => ({ ...d, source: readDiagramSource(d.file) }));

  return (
    <WorkspaceShell active="about">
      <header className="border-b border-stone-200 pb-5">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
        <p className={`mt-2 max-w-3xl ${INTRO}`}>
          {t.rich("intro", {
            path: () => <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">docs/diagrams/</code>,
            tag: () => <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em]">{"<<v2>>"}</code>,
            moss: (chunks) => <span className="font-medium text-moss">{chunks}</span>,
          })}
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {items.map((it) => (
          <section key={it.file} className={`${PANEL} p-5`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-h2 text-ink">{t(`items.${it.key}.label`)}</h2>
              <code className="text-meta text-steel">docs/diagrams/{it.file}</code>
            </div>
            <p className="mt-1 max-w-3xl text-base leading-7 text-steel">{t(`items.${it.key}.blurb`)}</p>
            {it.featured ? (
              <Legend live={t("legend.live")} gate={t("legend.gate")} gap={t("legend.gap")} />
            ) : null}
            {it.source ? (
              it.featured ? (
                <PipelineExplorer source={it.source} />
              ) : (
                <PlantUml source={it.source} scale="natural" className="mt-4" expandable />
              )
            ) : (
              <p className="mt-4 text-sm text-coral">{t("readError", { file: it.file })}</p>
            )}
          </section>
        ))}
      </div>
    </WorkspaceShell>
  );
}
