"use client";

// The "Issue Durable Skill Profile" button + share link, split out of
// DevSubmissionRow.tsx.
export function DevSubmissionRowSkillProfile({
  dsp,
  onIssue,
}: {
  dsp: { status: "idle" | "issuing" | "done" | "error"; token: string | null };
  onIssue: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-micro">
      <button
        type="button"
        onClick={onIssue}
        disabled={dsp.status === "issuing"}
        className="rounded border border-stone-300 px-2 py-1 text-ink hover:bg-stone-50 disabled:opacity-60"
      >
        {dsp.status === "issuing"
          ? "Issuing…"
          : dsp.status === "done"
            ? "Re-issue Durable Skill Profile"
            : "Issue Durable Skill Profile"}
      </button>
      {dsp.status === "done" && dsp.token ? (
        <a href={`/skill/${dsp.token}`} target="_blank" rel="noreferrer" className="text-ink underline">
          View / share credential ↗
        </a>
      ) : null}
      {dsp.status === "error" ? (
        <span className="text-coral">Couldn&apos;t issue — needs an evaluated submission + KP_SECRET.</span>
      ) : null}
    </div>
  );
}
