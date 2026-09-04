"use client";

// DATA5 — a finished task's outcome drawer: the compact result summary plus the
// deep link back to the entity the run concerned.
//
// The derivation moved OUT of this file (app/_lib/task-outcome-summary.ts) for one
// reason: a .tsx cannot be loaded by the node test runner, so the per-kind result
// reading and the deep-link routing had no test at all — and it showed. Every kind
// but batch_screen fell through an `Object.entries(result)` dump that printed the
// raw handler key in mono beside `String(value)`: the whole generated JD under
// `markdown`, `cached true`, `narrativeLang en`, `source deterministic`. Internal
// vocabulary, untranslated in all four locales, to the one person who opens this
// drawer. Now a pure table decides WHAT is said and this file only paints it.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { taskOutcomeLink, taskOutcomeSummary } from "@/app/_lib/task-outcome-summary";
import type { Task } from "./TasksProvider";

export function TaskOutcome({ task }: { task: Task }) {
  const t = useTranslations("tasks");
  // ONE key, two surfaces: the JD ledger's "build held as a revision" chip and this
  // dock line resolve the SAME `library.tab.buildHeldChip` string, so the drawer and
  // the library can never describe the same outcome two different ways. It rode the
  // generic scalar list before — a bare `bodyHeldAsRevision  true` row, untranslated
  // and unexplained, which is the whole reason this branch exists.
  const tLibrary = useTranslations("library.tab");
  const link = taskOutcomeLink(task);
  const result = task.result && typeof task.result === "object" ? (task.result as Record<string, unknown>) : null;
  const bodyHeld = result?.["bodyHeldAsRevision"] === true;
  // batch_screen keeps its bespoke SENTENCE (advanced / held / advisory / of total,
  // with ICU plurals) — a four-row label/value list would be a downgrade of copy
  // that already reads well. task-outcome-summary.ts records that exemption with
  // its reason, and its test fails if any OTHER kind acquires one silently.
  const lines = task.kind === "batch_screen" ? [] : taskOutcomeSummary(task.kind, result);
  return (
    <div className="space-y-1.5 rounded-md border border-stone-200 bg-paper/60 px-3 py-2">
      {bodyHeld ? (
        <p className="text-sm font-semibold text-amber-800">{tLibrary("buildHeldChip")}</p>
      ) : null}
      {task.kind === "batch_screen" && result ? (
        <p className="text-sm text-ink">
          <span className="font-semibold text-moss">{t("outcome.advanced", { count: Number(result["advanced"] ?? 0) })}</span>
          {" · "}
          <span className="font-semibold text-ink">{t("outcome.held", { count: Number(result["held"] ?? 0) })}</span>
          {" · "}
          <span className="text-steel">{t("outcome.advisory", { count: Number(result["advisory"] ?? 0) })}</span>
          {Number(result["errors"] ?? 0) > 0 ? (
            <span className="font-semibold text-coral"> · {t("outcome.errors", { count: Number(result["errors"]) })}</span>
          ) : null}
          <span className="text-steel"> · {t("outcome.ofTotal", { count: Number(result["total"] ?? 0) })}</span>
        </p>
      ) : lines.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {lines.map((line) => (
            <div key={line.labelKey} className="contents">
              <dt className="text-steel">{t(`outcome.field.${line.labelKey}`)}</dt>
              <dd className="min-w-0 truncate font-medium text-ink">
                {line.valueKey ? t(`outcome.value.${line.valueKey}`) : String(line.value ?? "")}
              </dd>
            </div>
          ))}
        </dl>
      ) : bodyHeld ? null : (
        <p className="text-sm text-steel">{task.status === "succeeded" ? t("outcome.noSummary") : t("outcome.noResult")}</p>
      )}
      {link ? (
        <Link href={link.href} className="focus-ring inline-block rounded text-sm font-semibold text-coral underline-offset-2 hover:underline">
          {t(`outcome.${link.key}`)} →
        </Link>
      ) : null}
    </div>
  );
}
