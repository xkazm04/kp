"use client";

import { useState } from "react";
import { Check, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; duplicate: boolean; ref: string | null }
  | { kind: "error"; message: string };

// The submission form half of the dev-case apply page (W5-1). POSTs to the
// SAME public inbound webhook external channels use — ack comms, dedup and
// lifecycle resume are the route's existing behavior, not re-implemented here.
export function DevApplyForm({ token }: { token: string }) {
  const t = useTranslations("devApply");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // A submitter's ONLY identity is what this form captures — a missing address
  // converts a winning evaluation into an unreachable candidate, so contact is
  // required on the PUBLIC form (the webhook stays lenient for external ATS
  // callers, which carry their own identity). Light shape check only.
  const contactValid = /\S+@\S+\.\S+/.test(contact.trim());
  const canSubmit =
    name.trim().length > 0 && repoRef.trim().length > 0 && contactValid && state.kind !== "sending" && state.kind !== "done";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setState({ kind: "sending" });
    try {
      const r = await fetch(`/api/devcase/inbound?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate: name.trim(),
          repoRef: repoRef.trim(),
          contact: contact.trim(),
          notes: notes.trim() || undefined,
        }),
      });
      const payload = (await r.json().catch(() => null)) as { error?: string; duplicate?: boolean; submissionId?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? t("submitFailed"));
      setState({
        kind: "done",
        duplicate: Boolean(payload?.duplicate),
        ref: typeof payload?.submissionId === "string" ? payload.submissionId : null,
      });
    } catch (caught) {
      setState({ kind: "error", message: caught instanceof Error ? caught.message : t("submitFailed") });
    }
  };

  if (state.kind === "done") {
    return (
      <div role="status" className="mt-4 rounded-md border border-moss/40 bg-moss/5 p-4">
        <p className="flex items-center gap-2 font-semibold text-moss">
          <Check size={16} aria-hidden /> {t("received")}
        </p>
        <p className="mt-1 text-sm text-steel">{state.duplicate ? t("receivedDuplicate") : t("receivedNote")}</p>
        {/* A durable handle on the submission — the page is otherwise a dead end
            once the form is gone. */}
        {state.ref ? <p className="mt-2 text-xs text-steel">{t("receivedRef", { ref: state.ref })}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-ink">
          {t("fieldName")} <span className="text-coral">*</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} required className="mt-1" />
        </label>
        <label className="block text-sm font-medium text-ink">
          {t("fieldContact")} <span className="text-coral">*</span>
          <TextInput
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
            placeholder={t("fieldContactPlaceholder")}
            className="mt-1"
          />
          <span className="mt-1 block text-xs font-normal text-steel">{t("fieldContactHint")}</span>
        </label>
      </div>
      <label className="block text-sm font-medium text-ink">
        {t("fieldRepo")} <span className="text-coral">*</span>
        <TextInput
          value={repoRef}
          onChange={(e) => setRepoRef(e.target.value)}
          required
          placeholder="https://github.com/you/solution"
          className="mt-1"
        />
      </label>
      <label className="block text-sm font-medium text-ink">
        {t("fieldNotes")}
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1" />
      </label>
      {state.kind === "error" ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-base font-semibold text-white hover:bg-steel disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send size={15} aria-hidden /> {state.kind === "sending" ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
