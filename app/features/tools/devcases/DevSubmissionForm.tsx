"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";

export function SubmissionForm({ postingId, onDone }: { postingId: string; onDone: () => void }) {
  const [candidate, setCandidate] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    if (!candidate.trim() || !repo.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/devcase/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId, candidateRef: candidate.trim(), repoRef: repo.trim() }),
      });
      // Only clear the inputs + reload on a real success. The old code cleared and
      // called onDone() unconditionally, so a non-2xx (validation, duplicate token,
      // SQLITE_BUSY, 500) silently dropped the submission while looking like it took.
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string } | null;
        setErr(p?.error ?? `Couldn't record submission (${r.status}).`);
        return;
      }
      setCandidate("");
      setRepo("");
      onDone();
    } catch {
      setErr("Network error — submission not recorded. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
      <input value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="candidate"
        className="focus-ring h-7 w-24 rounded border border-stone-200 bg-white px-1.5 text-micro text-ink caret-coral placeholder:text-steel" />
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="submission repo URL"
        className="focus-ring h-7 min-w-0 flex-1 rounded border border-stone-200 bg-white px-1.5 text-micro text-ink caret-coral placeholder:text-steel" />
      <button type="button" onClick={send} disabled={busy}
        className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-stone-200 px-2 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
        <Inbox size={11} /> {busy ? "…" : "Record"}
      </button>
      {err ? (
        <p role="alert" className="w-full text-micro text-coral">
          {err}
        </p>
      ) : null}
    </div>
  );
}
