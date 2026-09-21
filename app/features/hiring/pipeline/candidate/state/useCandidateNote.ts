"use client";

// The persistent recruiter note: the call facts ("wants 80k, available August,
// hybrid") that live on the entry. Hydrated from the board prop, reconciled with the
// server truth from the bundle, debounce-autosaved through `set_notes`, and flushed
// with keepalive when the candidate closes. Every bookkeeping decision is one pure
// function in pipelineDrawerNote.ts, pinned by its own test.

import { useEffect, useRef, useState } from "react";
import { noteUnmountAction, resolveNoteSave, shouldHydrateNote } from "../../pipelineDrawerNote";

/** Mirrors MAX_NOTES_LENGTH on /api/pipeline/[id], so the field can never assemble a
 *  note the route rejects. */
export const NOTE_MAX = 4000;

export function useCandidateNote({
  entryId,
  initial,
  bundleNotes,
  onChanged,
}: {
  entryId: string;
  initial: string | null | undefined;
  /** The server-truth note from the bundle; null until it lands. */
  bundleNotes: string | null;
  onChanged: () => void;
}) {
  const [candNote, setCandNote] = useState(initial ?? "");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // A genuine user edit since open — gates saves so hydration never echoes back.
  const noteDirtyRef = useRef(false);
  // A save SUCCEEDED this session: the board's copy is stale and owes ONE refresh on
  // close (not one per autosave, which defeated the open modal's poll pause).
  const noteSavedRef = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  // The freshest note, for the unmount flush. Declared before the effects that read it.
  const latestNoteRef = useRef(candNote);
  useEffect(() => {
    latestNoteRef.current = candNote;
  }, [candNote]);

  /** The only writer of a genuine edit; returned instead of the ref, so no consumer
   *  reads or writes a ref during render. */
  const changeNote = (value: string) => {
    noteDirtyRef.current = true;
    setCandNote(value);
  };

  useEffect(() => {
    if (!noteDirtyRef.current) return;
    const value = candNote; // the exact content this debounced save persists
    const h = window.setTimeout(() => {
      void fetch(`/api/pipeline/${encodeURIComponent(entryId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_notes", notes: value }),
      })
        .then((r) => {
          const res = resolveNoteSave({
            ok: r.ok,
            savedValue: value,
            latestValue: latestNoteRef.current,
            savedThisSession: noteSavedRef.current,
          });
          noteSavedRef.current = res.savedThisSession;
          if (res.clearDirty) noteDirtyRef.current = false;
          setNoteStatus(res.status);
        })
        .catch(() => setNoteStatus("error"));
    }, 600);
    return () => window.clearTimeout(h);
  }, [candNote, entryId]);

  // Overwrite from the server truth ONLY while the user has not edited in this open:
  // heals a stale board prop without ever clobbering in-progress typing.
  useEffect(() => {
    if (shouldHydrateNote(bundleNotes, noteDirtyRef.current)) setCandNote(bundleNotes as string);
  }, [bundleNotes]);

  // On close: flush a trailing edit the unmount just cancelled (keepalive survives the
  // navigation), or do the single deferred board refresh a landed save owes.
  useEffect(() => {
    return () => {
      const owed = noteUnmountAction({ dirty: noteDirtyRef.current, savedThisSession: noteSavedRef.current });
      if (owed === "flush") {
        void fetch(`/api/pipeline/${encodeURIComponent(entryId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_notes", notes: latestNoteRef.current }),
          keepalive: true,
        })
          .then((r) => {
            if (r.ok) onChangedRef.current();
          })
          .catch(() => {
            /* note save is best-effort — the debounced write already ran for all but the last pause */
          });
      } else if (owed === "refresh") {
        onChangedRef.current();
      }
    };
  }, [entryId]);

  return { candNote, changeNote, noteStatus, NOTE_MAX };
}
