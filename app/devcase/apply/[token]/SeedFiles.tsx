"use client";

import { Download, FileCode2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { downloadFile } from "@/app/_lib/export-utils";

export type SeedFile = { path: string; contents: string };

// The materialized starter tree, finally reachable by the candidate (W5-1 —
// the seed endpoint had zero callers anywhere). Per-file download + inline
// preview; no archive dependency, the seeds are a handful of small text files
// by construction (seed_materializer.py).
export function SeedFiles({ files, note }: { files: SeedFile[]; note: string | null }) {
  const t = useTranslations("devApply");

  const downloadAll = () => {
    // One concatenated bundle with clear file markers — keeps "grab everything"
    // a single click without shipping a zip library to a public page.
    const bundle = files.map((f) => `===== ${f.path} =====\n${f.contents}`).join("\n\n");
    downloadFile("starter-files.txt", bundle);
  };

  return (
    <section className="mt-6 rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-serif text-h3 text-ink">
          <FileCode2 size={18} className="text-coral" aria-hidden /> {t("seedHeading", { count: files.length })}
        </h2>
        <button
          type="button"
          onClick={downloadAll}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-sm font-semibold text-steel hover:bg-paper hover:text-ink"
        >
          <Download size={13} aria-hidden /> {t("seedDownloadAll")}
        </button>
      </div>
      {note ? <p className="mt-1 text-sm text-steel">{note}</p> : null}
      <ul className="mt-3 space-y-1.5">
        {files.map((f) => (
          <li key={f.path} className="rounded-md border border-stone-100 bg-paper/40">
            <details>
              <summary className="focus-ring flex cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-sm text-ink">
                {f.path}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    downloadFile(f.path.split("/").pop() || f.path, f.contents);
                  }}
                  title={t("seedDownloadOne")}
                  className="focus-ring ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-steel hover:text-ink"
                >
                  <Download size={11} aria-hidden />
                </button>
              </summary>
              <pre className="overflow-x-auto border-t border-stone-100 px-3 py-2 text-xs leading-5 text-steel">{f.contents}</pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
