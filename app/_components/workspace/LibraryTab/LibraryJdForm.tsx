"use client";

import { useState } from "react";
import { Save } from "lucide-react";

export function LibraryJdForm({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError("Title and body are both required.");
      return;
    }
    setSubmitting(true);
    setError(null);
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">Save a JD</h3>
      <p className="mt-2 text-sm text-steel">
        Stored locally in <code className="rounded bg-paper px-1 text-xs">data/kp.sqlite</code>.
      </p>

      <label htmlFor="jd-title" className="mt-4 block text-sm font-semibold text-ink">
        Title
      </label>
      <input
        id="jd-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Senior AI Automation Engineer — RetailCloud"
        className="focus-ring mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-ink"
      />

      <label htmlFor="jd-body" className="mt-4 block text-sm font-semibold text-ink">
        Body
      </label>
      <textarea
        id="jd-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={"Paste the full role requirements, responsibilities, seniority, skills, and salary range when available."}
        className="focus-ring mt-1 min-h-48 w-full resize-y rounded-md border border-stone-300 bg-white p-3 text-sm leading-6 text-ink"
      />
      <p className="mt-1 text-xs text-steel">{body.length} characters</p>

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="focus-ring mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Save className="h-4 w-4" aria-hidden />
        {submitting ? "Saving…" : "Save JD"}
      </button>
    </div>
  );
}
