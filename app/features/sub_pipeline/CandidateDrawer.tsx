"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Banknote, Calendar, Check, ClipboardList, Copy, ExternalLink, Mail, Pencil, Phone, Shuffle, Sparkles, UserCheck, X } from "lucide-react";
import { buildUrl } from "@/app/features/tabs";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { ResultView } from "./CandidateResultView";
import { ARCHETYPE, type Entry, type Result, type TaskId } from "./CandidateDrawerTypes";
import { RUBRIC_ANCHOR_LINE } from "@/app/_lib/interview-rubric";

const ACTIONS: { id: TaskId; label: string; icon: typeof Mail; stages: string[] | "all"; note?: string }[] = [
  { id: "screen", label: "Screen with AI", icon: UserCheck, stages: ["Screened"], note: "Routes to advance or holds for your review in Decisions." },
  { id: "prep", label: "Interview prep", icon: ClipboardList, stages: ["Screened", "Interview"] },
  { id: "scorecard", label: "Synthesize scorecard", icon: ClipboardList, stages: ["Interview"], note: "From your notes → a structured scorecard in Decisions." },
  { id: "offer", label: "Draft offer", icon: Banknote, stages: ["Offer"], note: "Salary from the role band, scaled by fit → an offer to approve in Decisions." },
  { id: "outreach", label: "Draft outreach", icon: Mail, stages: "all" },
  { id: "rejection", label: "Draft rejection", icon: Ban, stages: ["Screened", "Interview", "Offer"] },
  { id: "rematch", label: "Explore alternatives", icon: Shuffle, stages: ["Screened", "Interview", "Offer"] },
];

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: { competency: string; rating: number; evidence?: string }[];
  hasTranscript?: boolean;
};

export function CandidateDrawer({ entry, onClose, onChanged }: { entry: Entry; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const { startTask, tasks } = useTasks();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Voice 1st-round screen: create a grounded, tokenized candidate link.
  const [voiceProvider, setVoiceProvider] = useState<"openai" | "elevenlabs">("openai");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceLink, setVoiceLink] = useState<{ url: string; configured: boolean } | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Self-scheduling: mint a candidate link to pick an interview slot.
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedUrl, setSchedUrl] = useState<string | null>(null);
  const [schedErr, setSchedErr] = useState<string | null>(null);
  const [schedCopied, setSchedCopied] = useState(false);

  // Latest completed voice interview — surfaced as an evidence source in the
  // candidate's analysis (its scorecard also feeds the Decisions gate).
  const [ivOutcome, setIvOutcome] = useState<InterviewOutcome | null>(null);

  // Modal focus management: trap Tab within the dialog, close on Escape, and
  // restore focus to the trigger on unmount (WCAG dialog requirements).
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const node = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/interview/by-entry?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.session as { status?: string; transcript?: unknown[]; scorecard?: InterviewOutcome | null } | null;
        if (!alive || !s || s.status !== "completed") return;
        const sc = s.scorecard ?? null;
        setIvOutcome({
          recommendation: sc?.recommendation,
          summary: sc?.summary,
          ratings: sc?.ratings,
          hasTranscript: Array.isArray(s.transcript) && s.transcript.length > 0,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entry.id]);

  const a = ARCHETYPE[entry.archetype ?? "bau"] ?? ARCHETYPE.bau;
  const initials = entry.candidateLabel.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  const actions = ACTIONS.filter((act) => act.stages === "all" || act.stages.includes(entry.stage)).filter(
    (act) => entry.status === "active" || act.id === "rematch"
  );

  // Run through the background-task system: the work survives closing the drawer
  // or navigating away, and a duplicate click reuses the in-flight task (dedup).
  const run = async (task: TaskId) => {
    setBusy(task);
    setError(null);
    setResult(null);
    setPendingId(null);
    const t = await startTask("automation", {
      entryId: entry.id,
      task,
      notes: task === "scorecard" ? notes : undefined,
      entryLabel: entry.candidateLabel,
    });
    if (!t) {
      setError("Couldn't start the task.");
      setBusy(null);
      return;
    }
    setPendingId(t.id);
  };

  const createVoiceScreen = async () => {
    setVoiceBusy(true);
    setVoiceErr(null);
    setVoiceLink(null);
    setCopied(false);
    try {
      const res = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, provider: voiceProvider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `create failed (${res.status})`);
      setVoiceLink({ url: data.url, configured: Boolean(data.configured) });
    } catch (e) {
      setVoiceErr(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setVoiceBusy(false);
    }
  };

  const showVoice = entry.status === "active" && ["Screened", "Interview"].includes(entry.stage);
  const voiceFullUrl = voiceLink ? (typeof window !== "undefined" ? window.location.origin : "") + voiceLink.url : "";

  const showSchedule = entry.status === "active" && ["Screened", "Interview"].includes(entry.stage);
  const schedFullUrl = schedUrl ? (typeof window !== "undefined" ? window.location.origin : "") + schedUrl : "";
  const createScheduleLink = async () => {
    setSchedBusy(true);
    setSchedErr(null);
    setSchedUrl(null);
    setSchedCopied(false);
    try {
      const res = await fetch("/api/schedule/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `link failed (${res.status})`);
      setSchedUrl(data.url);
    } catch (e) {
      setSchedErr(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setSchedBusy(false);
    }
  };

  useEffect(() => {
    if (!pendingId) return;
    const t = tasks.find((x) => x.id === pendingId);
    if (!t) return;
    if (t.status === "succeeded") {
      const data = t.result as { result: Record<string, unknown>; source: string; applied: string } | null;
      const sub = (((t.params as { task?: string } | null)?.task ?? busy) ?? "screen") as TaskId;
      if (data) {
        setResult({ task: sub, data: data.result, source: data.source, applied: data.applied });
        if (["advanced", "held_for_review", "scorecard_ready", "offer_ready", "rematched"].includes(data.applied)) onChanged();
      }
      setBusy(null);
      setPendingId(null);
    } else if (t.status === "failed" || t.status === "canceled" || t.status === "interrupted") {
      setError(t.error ?? "Task did not complete.");
      setBusy(null);
      setPendingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, pendingId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="animate-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-paper shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-stone-200 bg-paper/95 p-4 backdrop-blur">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold text-white ${a.bg}`}>{initials}</span>
          <div className="min-w-0 flex-1">
            <p id="drawer-title" className="truncate font-serif text-lg text-ink">{entry.candidateLabel}</p>
            <p className="truncate text-sm text-steel">
              {a.label} · {entry.jobTitle} · <span className="text-ink">{entry.stage}</span>
            </p>
          </div>
          {entry.matchScore != null ? (
            <span className="rounded-md bg-white px-2 py-1 text-center">
              <span className="block font-serif text-lg leading-none text-ink">{entry.matchScore}</span>
              <span className="text-sm uppercase text-steel">match</span>
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {ivOutcome ? (
            <div className="rounded-md border border-moss/40 bg-moss/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
                  <Phone size={13} /> Interview outcome
                </p>
                {ivOutcome.recommendation ? (
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[ivOutcome.recommendation] ?? "bg-stone-100 text-steel"}`}>
                    {ivOutcome.recommendation}
                  </span>
                ) : null}
              </div>
              {ivOutcome.summary ? <p className="mt-1 text-sm text-ink">{ivOutcome.summary}</p> : null}
              {ivOutcome.ratings?.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {ivOutcome.ratings.slice(0, 5).map((r, i) => (
                    <li key={i} className="text-sm text-ink">
                      <span className="font-semibold nums text-coral">{r.rating}/5</span> {r.competency}
                    </li>
                  ))}
                </ul>
              ) : null}
              {ivOutcome.ratings?.length ? (
                <p className="mt-1 text-meta text-steel">Fixed rubric · {RUBRIC_ANCHOR_LINE}</p>
              ) : null}
              <p className="mt-1.5 text-meta text-steel">
                A voice 1st-round interview now feeds this candidate&apos;s scorecard review and assessment.
              </p>
            </div>
          ) : null}

          <div>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <Sparkles size={13} /> AI actions
            </p>
            <p className="mt-1 text-sm text-steel">Each task runs locally through the Claude CLI, with a deterministic fallback.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {actions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => run(act.id)}
                  disabled={busy !== null}
                  className={`focus-ring flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    result?.task === act.id ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                  }`}
                >
                  <act.icon size={14} className="shrink-0 text-coral" />
                  {busy === act.id ? "Working…" : act.label}
                </button>
              ))}
            </div>
          </div>

          {actions.some((act) => act.id === "scorecard") ? (
            <div>
              <label className="text-sm font-semibold uppercase tracking-wide text-steel">Interview notes (for scorecard)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Paste raw interviewer notes here, then click Synthesize scorecard."
                className="focus-ring mt-1 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
              />
            </div>
          ) : null}

          {showVoice ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
                <Phone size={13} /> Voice screen (1st round)
              </p>
              <p className="mt-1 text-sm text-steel">
                Creates a candidate link with questions grounded in this match. After the call, the scorecard lands in
                Decisions automatically.
              </p>
              <div className="mt-2 inline-flex rounded-md border border-stone-200 bg-paper p-0.5">
                {(["openai", "elevenlabs"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={voiceBusy}
                    aria-pressed={voiceProvider === p}
                    onClick={() => setVoiceProvider(p)}
                    className={`focus-ring rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                      voiceProvider === p ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                    }`}
                  >
                    {p === "openai" ? "OpenAI" : "ElevenLabs"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={createVoiceScreen}
                disabled={voiceBusy}
                className="focus-ring ml-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <Phone size={13} className="text-coral" /> {voiceBusy ? "Creating…" : "Create link"}
              </button>

              {voiceErr ? <p className="mt-2 text-sm text-red-700">{voiceErr}</p> : null}

              {voiceLink ? (
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      readOnly
                      value={voiceFullUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="focus-ring min-w-0 flex-1 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm text-ink"
                    />
                    <button
                      type="button"
                      title="Copy link"
                      onClick={() => {
                        void navigator.clipboard?.writeText(voiceFullUrl);
                        setCopied(true);
                      }}
                      className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <a
                      href={voiceLink.url}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                      title="Open as candidate"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                  {!voiceLink.configured ? (
                    <p className="text-sm text-coral">
                      {voiceProvider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID"} not set —
                      the call won&apos;t connect until configured.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {showSchedule ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
                <Calendar size={13} /> Self-scheduling
              </p>
              <p className="mt-1 text-sm text-steel">
                Send the candidate a link to pick their own interview slot — they get an instant confirmation and a
                reminder.
              </p>
              <button
                type="button"
                onClick={createScheduleLink}
                disabled={schedBusy}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <Calendar size={13} className="text-coral" /> {schedBusy ? "Creating…" : "Create scheduling link"}
              </button>
              {schedErr ? <p role="alert" className="mt-2 text-sm text-red-700">{schedErr}</p> : null}
              {schedUrl ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    readOnly
                    value={schedFullUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="focus-ring min-w-0 flex-1 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm text-ink"
                  />
                  <button
                    type="button"
                    title="Copy link"
                    onClick={() => {
                      void navigator.clipboard?.writeText(schedFullUrl);
                      setSchedCopied(true);
                    }}
                    className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                  >
                    {schedCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <a
                    href={schedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                    title="Open as candidate"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          {result ? <ResultView result={result} /> : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => {
                if (entry.candidateId) router.push(buildUrl({ tab: "match", profile: entry.candidateId }));
              }}
              className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
            >
              <ExternalLink size={13} /> Open full match in Profile &amp; Match
            </button>
            {entry.candidateId ? (
              <button
                type="button"
                onClick={() => router.push(buildUrl({ tab: "profile", edit: entry.candidateId as string }))}
                className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
              >
                <Pencil size={13} /> Edit profile
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
