"use client";

// DATA5 — a finished task's outcome drawer: the compact result summary plus the
// deep link back to the entity the run concerned. Split out of the row component
// (was TasksDoneRow.tsx, now TasksTableRow.tsx) so both stay under the 200-line
// file cap. Same derivation as before.
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Task } from "./TasksProvider";

// The deep-link targets a finished task offers. `key` names the copy in
// `tasks.outcome.*` rather than carrying a sentence — this is a pure router-ish
// derivation and holds no strings a user reads.
type OutcomeKey =
  | "openSavedReport"
  | "openJdLibrary"
  | "openRoleDecisions"
  | "openDecisions"
  | "reviewInDecisions"
  | "openSchedule"
  | "openBoard";

// batch_screen gets its rich counts; everything else falls back to the result's
// scalar fields (the generic shape readable without per-kind plumbing). The deep
// link is derived from params/result so a task row connects back to the entity it
// concerned.
function outcomeLink(task: Task): { href: string; key: OutcomeKey } | null {
  const params = (task.params as Record<string, unknown>) ?? {};
  const result = (task.result as Record<string, unknown>) ?? {};
  if (task.kind === "analyze") {
    const persistence = result["persistence"] as { slug?: unknown } | undefined;
    if (persistence && typeof persistence.slug === "string" && persistence.slug) {
      return { href: `/history/${encodeURIComponent(persistence.slug)}`, key: "openSavedReport" };
    }
    return null;
  }
  // The task id rides along (?jdTask=) so JdBuilder can rehydrate this build's
  // generated JD — a bare /?tab=library landed on an empty builder, because the
  // tab switch had unmounted the component that held the result.
  if (task.kind === "jd_build") {
    return { href: `/?tab=library&jdTask=${encodeURIComponent(task.id)}`, key: "openJdLibrary" };
  }
  // Decision-shaped runs land their output in the Decisions queue: a group eval
  // saves per-role (the ?job= filter isolates it), a batch screen raises
  // holds/reviews there.
  if (task.kind === "group_eval") {
    const jobId = params["jobId"] ?? params["roleKey"];
    return typeof jobId === "string" && jobId
      ? { href: `/?tab=decisions&job=${encodeURIComponent(jobId)}`, key: "openRoleDecisions" }
      : { href: "/?tab=decisions", key: "openDecisions" };
  }
  if (task.kind === "batch_screen") return { href: "/?tab=decisions", key: "reviewInDecisions" };
  // Prep artifacts are opened from the Schedule tab's candidate cards.
  if (task.kind === "interview_prep") return { href: "/?tab=schedule", key: "openSchedule" };
  // Entry-scoped kinds carry a label; ANA1's board ?q= filter isolates the
  // candidate (no per-entry deep link exists).
  const entryLabel = params["entryLabel"] ?? params["candidateLabel"];
  if (typeof entryLabel === "string" && entryLabel) {
    return { href: `/?tab=pipeline&q=${encodeURIComponent(entryLabel)}`, key: "openBoard" };
  }
  return null;
}

export function TaskOutcome({ task }: { task: Task }) {
  const t = useTranslations("tasks");
  // ONE key, two surfaces: the JD ledger's "build held as a revision" chip and this
  // dock line resolve the SAME `library.tab.buildHeldChip` string, so the drawer and
  // the library can never describe the same outcome two different ways. It rode the
  // generic scalar list before — a bare `bodyHeldAsRevision  true` row, untranslated
  // and unexplained, which is the whole reason this branch exists.
  const tLibrary = useTranslations("library.tab");
  const link = outcomeLink(task);
  const result = task.result && typeof task.result === "object" ? (task.result as Record<string, unknown>) : null;
  // Scalars only: nested blobs (full analysis payloads, drafts) belong on their
  // own surfaces — the deep link is the path to them.
  const bodyHeld = result?.["bodyHeldAsRevision"] === true;
  const scalars = result
    ? Object.entries(result)
        .filter(([k, v]) => k !== "bodyHeldAsRevision" && ["string", "number", "boolean"].includes(typeof v))
        .slice(0, 8)
    : [];
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
      ) : scalars.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {scalars.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-steel/80">{k}</dt>
              <dd className="min-w-0 truncate text-ink">{String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
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
