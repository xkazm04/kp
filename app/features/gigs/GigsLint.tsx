"use client";

import { useCallback } from "react";
import { Info, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { bySeverity, draftLines, type DraftLintFinding, type DraftLintSeverity } from "@/app/_lib/gigs/draft-lint";
import { marksByLine, splitAround } from "./gigsLogic";
import { useGigsFormat } from "./useGigsFormat";

// The pre-send lint as the desk shows it, twice over and in one state: a strip above the
// draft listing every finding, and margin marks beside the exact draft line a finding
// refers to (the Proof Room borrowing). A warn is marked "seen" in either place - the
// strip's box and the margin's "noted" box are the same fact.

/** The finding's sentence in the reader's language. */
export function useLintText() {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return useCallback(
    (f: DraftLintFinding): string => {
      const params: Record<string, string | number> = { ...f.params };
      if (typeof params.deadline === "string") params.deadline = fmt.date(params.deadline);
      if (typeof params.kind === "string") params.kind = t.has(`evidenceKind.${params.kind}` as Parameters<typeof t>[0]) ? t(`evidenceKind.${params.kind}` as Parameters<typeof t>[0]) : params.kind;
      return t(`lint.${f.messageKey}` as Parameters<typeof t>[0], params as never);
    },
    [t, fmt]
  );
}

/** Severity differs by shape as well as colour: a filled square, an outlined diamond,
 *  an outlined circle. */
export function SeverityIcon({ severity }: { severity: DraftLintSeverity }) {
  if (severity === "blocker") {
    return (
      <span aria-hidden className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-coral text-white">
        <X size={14} strokeWidth={3} />
      </span>
    );
  }
  if (severity === "warn") {
    return (
      <span aria-hidden className="inline-grid h-5 w-5 shrink-0 place-items-center">
        <span className="inline-block h-3.5 w-3.5 rotate-45 border-2 border-amber-600 bg-paper" />
      </span>
    );
  }
  return (
    <span aria-hidden className="inline-grid h-5 w-5 shrink-0 place-items-center text-blue-700">
      <Info size={18} />
    </span>
  );
}

export function anchorIdFor(f: DraftLintFinding, uid: string): string | null {
  if (f.line !== null) return `${uid}-line-${f.line}`;
  const m = /^evidence:(\d+):/.exec(f.id);
  if (m) return `${uid}-ev-${m[1]}`;
  return null;
}

export function LintStrip({
  findings,
  seen,
  onSeen,
  onJump,
  uid,
}: {
  findings: readonly DraftLintFinding[];
  seen: ReadonlySet<string>;
  onSeen: (id: string, value: boolean) => void;
  onJump: (anchorId: string) => void;
  uid: string;
}) {
  const t = useTranslations("gigs");
  const text = useLintText();
  const sorted = bySeverity(findings);
  return (
    <section className="border-b border-stone-200 bg-stone-50 px-5 py-3" aria-label={t("lint.stripLabel")}>
      <h3 className={META_LABEL}>{t("lint.title", { count: findings.length })}</h3>
      {sorted.length === 0 ? (
        <p className="mt-1.5 text-sm text-steel">{t("lint.none")}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {sorted.map((f) => {
            const anchor = anchorIdFor(f, uid);
            const isSeen = seen.has(f.id);
            return (
              <li key={f.id} className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 text-sm ${f.severity === "warn" && isSeen ? "opacity-60" : ""}`}>
                <SeverityIcon severity={f.severity} />
                <span className="text-ink">
                  <span className="sr-only">{t(`lint.severity.${f.severity}` as Parameters<typeof t>[0])}: </span>
                  {text(f)}
                  {anchor ? (
                    <button type="button" onClick={() => onJump(anchor)} className="focus-ring ml-2 text-sm font-semibold text-coral underline-offset-2 hover:underline">
                      {f.line !== null ? t("lint.goLine", { line: f.line }) : t("lint.goEvidence")}
                    </button>
                  ) : null}
                </span>
                {f.severity === "warn" ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm text-steel">
                    <input type="checkbox" checked={isSeen} onChange={(e) => onSeen(f.id, e.target.checked)} className="h-4 w-4 accent-moss" />
                    {t("lint.seen")}
                  </label>
                ) : f.severity === "blocker" ? (
                  <span className={`${NOTICE("critical")} inline-block whitespace-nowrap px-2 py-0.5 text-xs font-semibold`}>{t("lint.blocksApprove")}</span>
                ) : (
                  <span className={`${CHIP_QUIET} text-xs`}>{t("lint.note")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The draft as a numbered galley with margin marks beside their line. Below `lg` the
 *  margin folds under each line instead of beside it. */
export function DraftGalley({
  text,
  findings,
  seen,
  onSeen,
  uid,
}: {
  text: string;
  findings: readonly DraftLintFinding[];
  seen: ReadonlySet<string>;
  onSeen: (id: string, value: boolean) => void;
  uid: string;
}) {
  const t = useTranslations("gigs");
  const lintText = useLintText();
  const lines = draftLines(text);
  const marks = marksByLine(findings);
  return (
    <ol className="grid grid-cols-[2.5rem_minmax(0,1fr)] lg:grid-cols-[2.5rem_minmax(0,1fr)_15rem]" aria-label={t("draft.galleyLabel")}>
      {lines.map((line, i) => {
        const n = i + 1;
        const here = marks.get(n) ?? [];
        const firstExcerpt = here.map((f) => f.params.excerpt).find((x): x is string => typeof x === "string");
        const parts = splitAround(line, firstExcerpt);
        return (
          <li key={n} id={`${uid}-line-${n}`} className="contents">
            <span className="select-none border-r border-stone-200 pr-2 pt-0.5 text-right font-mono text-xs leading-7 text-steel" aria-hidden>
              {line.trim() ? n : ""}
            </span>
            <span className={`min-h-7 whitespace-pre-wrap break-words px-4 font-serif text-base leading-7 text-ink dark:font-sans ${here.length ? "bg-amber-50/60" : ""}`}>
              <span className="sr-only">{t("draft.lineN", { n })} </span>
              {parts ? (
                <>
                  {parts[0]}
                  <mark className="rounded-sm bg-amber-100 px-0.5 text-ink underline decoration-amber-600 decoration-wavy underline-offset-4">{parts[1]}</mark>
                  {parts[2]}
                </>
              ) : (
                line
              )}
            </span>
            <span className={`col-start-2 px-4 pb-1 lg:col-start-auto lg:border-l lg:border-dashed lg:border-stone-300 lg:px-2 ${here.length ? "" : "hidden lg:block"}`}>
              {here.map((f) => {
                const isSeen = seen.has(f.id);
                return (
                  <span
                    key={f.id}
                    className={`mb-1.5 block rounded-md border px-2 py-1 text-sm dark:rounded-lg dark:-rotate-1 ${isSeen ? "border-stone-200 text-steel opacity-70" : "border-amber-600 bg-white text-ink"}`}
                  >
                    {lintText(f)}
                    {f.severity === "warn" ? (
                      <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-sm text-steel">
                        <input type="checkbox" checked={isSeen} onChange={(e) => onSeen(f.id, e.target.checked)} className="h-4 w-4 accent-moss" />
                        {t("lint.noted")}
                      </label>
                    ) : null}
                  </span>
                );
              })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
