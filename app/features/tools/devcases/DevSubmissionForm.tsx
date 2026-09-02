"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";

export function SubmissionForm({ postingId, onDone }: { postingId: string; onDone: () => void }) {
  const t = useTranslations("devcase.submissionForm");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [candidate, setCandidate] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // WHICH success just happened. `intakeSubmission` is idempotent per (posting,
  // candidate, repo): a re-submission is ABSORBED into the existing row rather than
  // filed again. The form claimed a fresh record either way, so a recruiter retrying
  // after a slow response believed a second submission existed — and then looked for
  // it in a list that (correctly) still showed one.
  const [receipt, setReceipt] = useState<"recorded" | "duplicate" | null>(null);

  const send = async () => {
    if (!candidate.trim() || !repo.trim()) return;
    setBusy(true);
    setErr(null);
    setReceipt(null);
    try {
      const r = await fetch("/api/devcase/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId, candidateRef: candidate.trim(), repoRef: repo.trim() }),
      });
      // Only clear the inputs + reload on a real success. The old code cleared and
      // called onDone() unconditionally, so a non-2xx (validation, duplicate token,
      // SQLITE_BUSY, 500) silently dropped the submission while looking like it took.
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string; isNew?: boolean } | null;
      if (!r.ok) {
        setErr(errMsg(p, t("failed")));
        return;
      }
      setReceipt(p?.isNew === false ? "duplicate" : "recorded");
      setCandidate("");
      setRepo("");
      onDone();
    } catch {
      setErr(t("network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
      <input value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder={t("candidatePlaceholder")}
        className="focus-ring h-7 w-24 rounded border border-stone-200 bg-white px-1.5 text-micro text-ink caret-coral placeholder:text-steel" />
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={t("repoPlaceholder")}
        className="focus-ring h-7 min-w-0 flex-1 rounded border border-stone-200 bg-white px-1.5 text-micro text-ink caret-coral placeholder:text-steel" />
      <button type="button" onClick={send} disabled={busy}
        className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-stone-200 px-2 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
        <Inbox size={11} /> {busy ? t("recording") : t("record")}
      </button>
      {err ? (
        <p role="alert" className="w-full text-micro text-coral">
          {err}
        </p>
      ) : null}
      {receipt && !err ? (
        <p role="status" className={`w-full text-micro ${receipt === "duplicate" ? "text-amber-700" : "text-moss"}`}>
          {receipt === "duplicate" ? t("receiptDuplicate") : t("receiptRecorded")}
        </p>
      ) : null}
    </div>
  );
}
