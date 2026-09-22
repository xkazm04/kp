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
import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { taskOutcomeLink, taskOutcomeSummary } from "@/app/_lib/task-outcome-summary";
import { FANOUT_CODES, fanoutOutcome, retryScopes, type RetryScope } from "@/app/_lib/task-fanout";
import { useTasks, type Task } from "./TasksProvider";

// The per-candidate half of a fan-out run (batch_screen / batch_outreach): WHY items
// failed, by code, how many a stopped run never reached, and a retry scoped to
// exactly those — the rest of the cohort is not touched (or paid for) again. Reads
// the stored ledger through app/_lib/task-fanout.ts; the row holds ids and codes
// only, so this says how many and why, never who. Renders nothing for a row with no
// ledger (an older run stored counts only, which cannot name whom to retry).
function FanoutLedger({ task }: { task: Task }) {
  const t = useTranslations("tasks.outcome.fanout");
  const { retryTask } = useTasks();
  const [pending, setPending] = useState<RetryScope | null>(null);
  const out = fanoutOutcome(task.kind, task.params, task.result, task.status);
  if (!out) return null;
  const scopes = retryScopes(task.kind, task.params, task.result, task.status);
  const codes = FANOUT_CODES.filter((c) => (out.byCode[c] ?? 0) > 0);
  if (codes.length === 0 && out.unreachedIds.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-stone-200 pt-1.5">
      {codes.length > 0 ? (
        <p className="text-sm text-ink">
          <span className="font-semibold text-coral">{t("failedBy")}</span>{" "}
          {codes.map((c) => t("codeCount", { label: t(`code.${c}`), count: out.byCode[c] ?? 0 })).join(" · ")}
        </p>
      ) : null}
      {out.unreachedIds.length > 0 ? <p className="text-sm text-steel">{t("unreached", { count: out.unreachedIds.length })}</p> : null}
      {scopes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {scopes.map((scope) => (
            <button
              key={scope}
              type="button"
              disabled={pending !== null}
              title={t("retryTitle")}
              onClick={() => {
                setPending(scope);
                void retryTask(task.id, scope).finally(() => setPending(null));
              }}
              className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`}
            >
              <RefreshCw size={12} className={pending === scope ? "animate-spin" : ""} aria-hidden />
              {scope === "failed"
                ? t("retryFailed", { count: out.failedIds.length })
                : t("retryUnreached", { count: out.unreachedIds.length })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
      <FanoutLedger task={task} />
      {link ? (
        <Link href={link.href} className="focus-ring inline-block rounded text-sm font-semibold text-coral underline-offset-2 hover:underline">
          {t(`outcome.${link.key}`)} →
        </Link>
      ) : null}
    </div>
  );
}
