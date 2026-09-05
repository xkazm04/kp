"use client";

// Insights → Activity, row detail. The table answers "what ran, and what did it
// cost"; this answers the question the table always raised and could never
// reach — "and what did it actually produce?".
//
// The ledger row itself has never carried a payload (llm_usage stores meters,
// not content). What it now carries is `request_id`: the background-task run the
// metered call belonged to, stamped through the chain
//   tasks.ts (withLlmRequestId) → python-runner (KP_LLM_REQUEST_ID)
//   → monitor.py (_append_ledger) → llm_usage.request_id.
// With that key the detail fetches the owning run from GET /api/tasks/[id] —
// the one endpoint that serves the full result blob, which the 2s task poll
// deliberately projects away — and renders it through StructuredReadout.
//
// Three honest degradations, because each is a different fact and a single
// "no output" would flatten them:
//   • no request id  → the call ran outside a tracked run (an inline route, a
//     direct CLI). Nothing was ever stored to link to.
//   • id, no task    → the run existed but has aged out of task retention.
//   • task, no result→ the run stored no output (it failed, or produced none).
import { useFormatter, useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { Modal } from "@/app/_components/Modal";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { StructuredReadout } from "@/app/_components/ui/StructuredReadout";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { Task } from "@/app/features/shell/tasks/TasksProvider";
import type { LlmActivityRow } from "@/app/_lib/db/llm";

const TONE_BY_STATUS: Record<string, BadgeTone> = {
  succeeded: "positive",
  running: "info",
  queued: "neutral",
  failed: "critical",
  canceled: "neutral",
  interrupted: "caution",
};

/** One label/value line of the ledger facts — the same shape the readout uses. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="min-w-[9rem] text-meta uppercase text-steel">{label}</span>
      <span className="min-w-0 flex-1 break-words text-base text-ink">{children}</span>
    </div>
  );
}

/**
 * The owning run's output. Mounted ONLY when the row has a request id, so the
 * fetch hook is called unconditionally within it (no conditional-hook branch)
 * and a row with nothing to fetch costs no request at all.
 */
function LinkedRun({ requestId }: { requestId: string }) {
  const t = useTranslations("activity");
  const tTasks = useTranslations("tasks");
  const format = useFormatter();
  // The error TEXT is deliberately ignored: GET /api/tasks/[id] answers a missing
  // row with an English `{ error }` body, and this is a 4-locale surface. A failed
  // read here means exactly one user-visible thing — the run is no longer
  // available — so it is said once, in the reader's language.
  const { data, error } = useJsonFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(requestId)}`, "");
  const task = data?.task ?? null;

  if (error) return <p className="text-base text-steel">{t("runGone")}</p>;
  if (!task) return <div className="reveal-quiet min-h-[6rem]" aria-hidden />;

  const statusKey = `status.${task.status}` as Parameters<typeof tTasks>[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE_BY_STATUS[task.status] ?? "neutral"} label={tTasks.has(statusKey) ? tTasks(statusKey) : task.status} />
        {task.finishedAt ? (
          <span className="text-sm text-steel nums">
            {format.dateTime(new Date(task.finishedAt), { dateStyle: "medium", timeStyle: "short" })}
          </span>
        ) : null}
      </div>

      {/* A failed run's error is the output — show it instead of an empty readout. */}
      {task.error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{task.error}</p>
      ) : (
        <StructuredReadout value={task.result} emptyLabel={t("runNoOutput")} />
      )}
    </div>
  );
}

export function ActivityDetailModal({
  row,
  caseLabel,
  onClose,
}: {
  row: LlmActivityRow;
  /** The tab already owns the use-case label lookup (with its has() fallback). */
  caseLabel: (useCase: string) => string;
  onClose: () => void;
}) {
  const t = useTranslations("activity");
  const format = useFormatter();
  // Same formatter as the table row that opened this modal (ActivityTab): the
  // reader's number locale, never the runtime's default.
  const { grouped } = useNumberFormat();
  const num = (v: number | null) => (v == null ? "—" : grouped(v));

  return (
    <Modal
      title={caseLabel(row.useCase)}
      subtitle={format.dateTime(new Date(row.ts), { dateStyle: "full", timeStyle: "medium" })}
      onClose={onClose}
      size="3xl"
    >
      <div className="space-y-6">
        <section className="space-y-1">
          <h3 className="text-meta uppercase text-coral">{t("detailLedger")}</h3>
          <div className="space-y-1 pt-1">
            <Fact label={t("colProvider")}>{row.provider}</Fact>
            <Fact label={t("colModel")}>
              <span className="font-mono text-sm">{row.model ?? "—"}</span>
            </Fact>
            <Fact label={t("colSource")}>
              {row.source === "llm" ? (
                <span className="font-medium text-moss">{t("sourceLlm")}</span>
              ) : (
                <span className="text-steel">{t("sourceDeterministic")}</span>
              )}
            </Fact>
            <Fact label={t("colTokens")}>
              <span className="nums">{t("tokens", { input: num(row.inputTokens), output: num(row.outputTokens) })}</span>
            </Fact>
            {/* Cached tokens are a real cost lever and the table has no room for
                them; the detail is where they belong. Omitted when unreported —
                "0 cached" and "the provider didn't say" are different facts. */}
            {row.cachedTokens != null ? (
              <Fact label={t("detailCached")}>
                <span className="nums">{num(row.cachedTokens)}</span>
              </Fact>
            ) : null}
            <Fact label={t("colCost")}>
              {/* Same contract as the table: an unpriced call is "—", never $0. */}
              <span className="nums">{row.costUsd == null ? "—" : `$${row.costUsd.toFixed(4)}`}</span>
            </Fact>
          </div>
        </section>

        <section className="space-y-2 border-t border-stone-200 pt-5">
          <h3 className="text-meta uppercase text-coral">{t("detailOutput")}</h3>
          {row.requestId ? (
            <LinkedRun requestId={row.requestId} />
          ) : (
            <p className="text-base text-steel">{t("runUnlinked")}</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
