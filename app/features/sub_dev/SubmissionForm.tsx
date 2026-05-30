"use client";

import { useState } from "react";
import { Inbox } from "lucide-react";

export function SubmissionForm({ postingId, onDone }: { postingId: string; onDone: () => void }) {
  const [candidate, setCandidate] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!candidate.trim() || !repo.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/devcase/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId, candidateRef: candidate.trim(), repoRef: repo.trim() }),
      });
      setCandidate("");
      setRepo("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-100 pt-2">
      <input value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="candidate"
        className="focus-ring h-7 w-24 rounded border border-stone-200 px-1.5 text-micro" />
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="submission repo URL"
        className="focus-ring h-7 min-w-0 flex-1 rounded border border-stone-200 px-1.5 text-micro" />
      <button type="button" onClick={send} disabled={busy}
        className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-stone-200 px-2 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
        <Inbox size={11} /> {busy ? "…" : "Record"}
      </button>
    </div>
  );
}
