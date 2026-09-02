"use client";

// Gap #1 of the dev-case feature doc, closed: the reviewer can open the candidate's
// chat transcript and their submitted tree.
//
// The workspace-authed `GET /api/devcase/session/[id]` has returned both since the Live
// Work Surface shipped and had ZERO callers — the evidence the product calls its
// strongest (a watched process, not a reconstructed git log) was reachable only by
// reading the database. Everything a reviewer could see about a live session was the
// mechanical verdict computed FROM it.
//
// Three deliberate choices:
//
//   * FETCH ON OPEN, not on mount. A submission list renders many rows; a transcript
//     plus a full file tree per row is a real payload (50 files x 256KB is the server's
//     own cap), and a reviewer opens one. The request fires once and the result is kept.
//   * THE JUDGE SEAT SITS BESIDE THE EVIDENCE, through the SAME `judgeSeatState` the
//     integrity strip uses — semantics untouched, including the asymmetry: only
//     `self_grading` renders. A reviewer about to read raw evidence is exactly who needs
//     to know the gate over it was the model that produced it. `independent` still says
//     nothing (the runtime evaluation is not itself judged) and `absent` still says
//     nothing.
//   * SIZES, NOT PREVIEWS. The list names each file and how much is in it. Rendering
//     candidate-authored file CONTENTS inline would put an unbounded, unreviewed blob in
//     the recruiter's page for no decision it helps them make; the size answers the
//     question a reviewer actually asks of a tree at a glance.
import { useCallback, useState } from "react";
import { FileText, Gavel, MessageSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { judgeSeatState } from "@/app/_lib/devcase-judge-independence";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { sessionEvidenceModel, type SessionEvidenceModel, type SessionEvidencePayload } from "./devcase-session-evidence";

export function DevSessionEvidencePanel({
  sessionId,
  judgeIndependence,
}: {
  /** The work-session id from the submission's `repoRef`. A repo submission has none
   *  and the caller renders nothing — there is no observed session to read. */
  sessionId: string;
  judgeIndependence?: unknown;
}) {
  const t = useTranslations("devcase.sessionEvidence");
  // REUSED, not re-worded: the judge-seat sentence has one owner, the integrity strip's
  // catalog, so the two surfaces can never state the same fact differently.
  const tIntegrity = useTranslations("devcase.integrity");
  const locale = useLocale();
  const errMsg = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [model, setModel] = useState<SessionEvidenceModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const judge = judgeSeatState(judgeIndependence);

  const bytes = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "byte",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  });

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/devcase/session/${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorPayload | null;
        // The CODE in the reader's language, never the server's English `error` string.
        setError(errMsg(body, t("loadFailed")));
        setState("error");
        return;
      }
      setModel(sessionEvidenceModel((await res.json()) as SessionEvidencePayload));
      setState("ready");
    } catch {
      // Network only — the fetch never resolved, so there is no body and no code to
      // resolve. Say the generic thing rather than nothing.
      setError(t("loadFailed"));
      setState("error");
    }
  }, [sessionId, errMsg, t]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state === "idle") void load();
  };

  return (
    <div className="mt-2 border-t border-stone-100 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel hover:text-ink"
        >
          <FileText size={11} aria-hidden /> {open ? t("hide") : t("show")}
        </button>
        {judge === "self_grading" ? (
          <span
            title={tIntegrity("judgeSelfGradingTitle")}
            className="inline-flex items-center gap-1 rounded bg-coral/15 px-1.5 py-0.5 text-micro font-semibold uppercase text-coral"
          >
            <Gavel size={11} aria-hidden /> {tIntegrity("judgeSelfGrading")}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2">
          {state === "loading" ? (
            <div aria-live="polite" className="space-y-1.5">
              <span className="sr-only">{t("loading")}</span>
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : null}

          {state === "error" ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-2 py-1.5 text-micro text-coral">
              <span className="min-w-0">{error}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-coral/40 bg-white px-1.5 py-0.5 font-semibold text-coral hover:bg-coral/10"
              >
                {t("retry")}
              </button>
            </div>
          ) : null}

          {state === "ready" && model ? (
            model.isEmpty ? (
              // Not an error and not a blank: this candidate opened the link and left
              // nothing behind, which is itself a fact the reviewer is weighing.
              <p className="rounded-md bg-paper px-2 py-1.5 text-micro text-steel">{t("empty")}</p>
            ) : (
              <div className="space-y-2">
                <div>
                  <p className="mb-1 flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-steel">
                    <MessageSquare size={11} aria-hidden /> {t("transcriptTitle", { count: model.turns.length })}
                  </p>
                  {model.turns.length === 0 ? (
                    <p className="text-micro text-steel">{t("noTranscript")}</p>
                  ) : (
                    <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-stone-200 bg-paper/50 p-1.5">
                      {model.turns.map((turn) => (
                        <li
                          key={`${turn.channel}-${turn.seq}`}
                          className={`max-w-prose whitespace-pre-wrap rounded px-2 py-1 text-micro leading-relaxed ${
                            turn.role === "user" ? "ml-auto bg-ink text-white" : "bg-white text-ink"
                          }`}
                        >
                          <span className="mr-1 text-micro font-semibold uppercase opacity-70">
                            {turn.role === "user" ? t("roleCandidate") : t("roleAssistant")}
                          </span>
                          {turn.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-1 flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-steel">
                    <FileText size={11} aria-hidden />{" "}
                    {t("filesTitle", { count: model.files.length, total: bytes.format(model.totalBytes) })}
                  </p>
                  {model.files.length === 0 ? (
                    <p className="text-micro text-steel">{t("noFiles")}</p>
                  ) : (
                    <ul className="max-h-40 divide-y divide-stone-100 overflow-y-auto rounded-md border border-stone-200">
                      {model.files.map((f) => (
                        <li key={f.path} className="flex items-center gap-2 px-2 py-1 text-micro">
                          <span className="truncate font-mono text-ink">{f.path}</span>
                          <span className="ml-auto shrink-0 nums text-steel">{bytes.format(f.bytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
