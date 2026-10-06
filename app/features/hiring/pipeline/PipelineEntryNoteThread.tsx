"use client";

// The authored note THREAD under the scratchpad in the candidate drawer: who wrote
// what and when, newest last, plus a small composer. Append-only — there is no edit or
// delete here because the server has no such door. The author is stamped server-side
// from the session; this component only sends the text. A note written with no signed-in
// user (local mode) reads as "Local user". Split out of the Record tab.

import { useCallback, useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { NOTE_MAX } from "./candidate/state/useCandidateNote";

type ThreadNote = { id: string; authorUserId: string | null; authorName: string | null; body: string; createdAt: string };

export function PipelineEntryNoteThread({ entryId }: { entryId: string }) {
  const t = useTranslations("pipeline.drawer");
  const errorMessage = useErrorMessage();
  const ago = useRelativeTime();
  const [notes, setNotes] = useState<ThreadNote[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/pipeline/${encodeURIComponent(entryId)}`;

  // One read, shared by the open and the post-append refresh. Promise-chained (setState
  // only inside callbacks) so the open can run from an effect.
  const read = useCallback(
    () =>
      fetch(`${url}/notes`)
        .then((r) => (r.ok ? (r.json() as Promise<{ notes: ThreadNote[] }>) : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          setNotes(data.notes);
          setLoadFailed(false);
        })
        .catch(() => {
          /* best-effort read: shown as a quiet line, the composer stays usable */
          setLoadFailed(true);
        }),
    [url]
  );

  useEffect(() => {
    void read();
  }, [read]);

  const send = async () => {
    const note = draft.trim();
    if (!note || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_note", note }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        setError(errorMessage(body, t("noteThreadSendFailed"), { max: NOTE_MAX }));
        return;
      }
      setDraft("");
      await read();
    } catch {
      /* network failure: said once, the draft is kept so nothing typed is lost */
      setError(t("noteThreadSendFailed"));
    } finally {
      setSending(false);
    }
  };

  const author = (n: ThreadNote) => (n.authorUserId === null ? t("noteThreadLocalUser") : (n.authorName ?? t("noteThreadFormerMember")));

  return (
    <div>
      <div className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <MessagesSquare size={13} /> {t("noteThreadTitle")}
      </div>
      {loadFailed ? <p className="mt-1 text-meta text-coral">{t("noteThreadLoadFailed")}</p> : null}
      {notes && notes.length === 0 ? <p className="mt-1 text-meta text-steel">{t("noteThreadEmpty")}</p> : null}
      {notes && notes.length > 0 ? (
        <ul className="mt-1 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-stone-200 pl-3">
              <div className="flex items-baseline gap-2 text-meta text-steel">
                <span className="font-medium text-ink">{author(n)}</span>
                <span>{ago(n.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-body text-ink">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <TextArea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        autoGrow
        maxLength={NOTE_MAX}
        placeholder={t("noteThreadPlaceholder")}
        aria-label={t("noteThreadTitle")}
        sizeVariant="sm"
        className="mt-2"
      />
      <div className="mt-1 flex items-center gap-3">
        <button type="button" onClick={() => void send()} disabled={sending || draft.trim() === ""} className={`${BTN_PRIMARY} h-9 px-4 text-meta`}>
          {sending ? t("noteThreadSending") : t("noteThreadSend")}
        </button>
        {error ? (
          <span role="alert" className="text-meta text-coral">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
