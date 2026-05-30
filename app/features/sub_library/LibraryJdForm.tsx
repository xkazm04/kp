"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { JD_BODY_MAX_LENGTH, JD_TITLE_MAX_LENGTH } from "@/app/_lib/jd-limits";

export function LibraryJdForm({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending auto-dismiss timer if the form unmounts mid-confirmation.
  useEffect(() => {
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
    };
  }, []);

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError("Title and body are both required.");
      return;
    }
    // Client-side guard mirroring the server caps so oversized pastes fail fast
    // with a clear message instead of a round-trip 400.
    if (title.trim().length > JD_TITLE_MAX_LENGTH) {
      setError(`Title must be ${JD_TITLE_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (body.trim().length > JD_BODY_MAX_LENGTH) {
      setError(`Body must be ${JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/jds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Save failed (${response.status}).`);
      }
      setTitle("");
      setBody("");
      onSaved();
      // Transient confirmation so the action loop closes instead of silently
      // clearing the fields; auto-dismisses after ~2s.
      setSaved(true);
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
      savedTimeout.current = setTimeout(() => setSaved(false), 2000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">Save a JD</h3>
      <p className="mt-2 text-base text-steel">
        Stored locally in <code className="rounded bg-paper px-1 text-sm">data/kp.sqlite</code>.
      </p>

      <label htmlFor="jd-title" className="mt-4 block text-base font-semibold text-ink">
        Title
      </label>
      <input
        id="jd-title"
        type="text"
        value={title}
        maxLength={JD_TITLE_MAX_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Senior AI Automation Engineer — RetailCloud"
        className="focus-ring mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-base text-ink"
      />

      <label htmlFor="jd-body" className="mt-4 block text-base font-semibold text-ink">
        Body
      </label>
      <textarea
        id="jd-body"
        value={body}
        maxLength={JD_BODY_MAX_LENGTH}
        onChange={(event) => setBody(event.target.value)}
        placeholder={"Paste the full role requirements, responsibilities, seniority, skills, and salary range when available."}
        className="focus-ring mt-1 min-h-48 w-full resize-y rounded-md border border-stone-300 bg-white p-3 text-base leading-6 text-ink"
      />
      <p className={`mt-1 text-sm ${body.length >= JD_BODY_MAX_LENGTH * 0.9 ? "text-coral" : "text-steel"}`}>
        {body.length.toLocaleString("en-US")} / {JD_BODY_MAX_LENGTH.toLocaleString("en-US")} characters
      </p>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-base font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {submitting ? "Saving…" : "Save JD"}
        </button>
        {saved ? (
          <span className="animate-fade-in inline-flex items-center gap-1 text-base font-semibold text-moss" role="status">
            <Check className="h-4 w-4" aria-hidden /> Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
