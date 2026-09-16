"use client";

// The ONE data hook all three prototype variants read and write through.
//
// It owns no transport of its own: the request shapes, the response→outcome
// classification and the list load are the pure helpers already written for the
// JD-library template manager (app/features/library/jds/jdsTemplateClient.ts),
// and they are imported rather than re-implemented — the two managers are two
// views of the same `/api/templates` routes, so a second copy of the CAS stamp
// handling or the 409 classification would be a second thing to keep right.
//
// What this adds on top is the bucket convention (templateKinds.ts) and the
// house error rule: a failure is resolved from its machine CODE through
// useErrorMessage(), never from the server's English `error` string.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { findUnknownPlaceholders, validateTemplateFields } from "@/app/features/shared/renderTemplate";
import {
  loadManagedTemplates,
  sendTemplateWrite,
  templateSaveRequest,
  type ManagedTemplate,
} from "@/app/features/library/jds/jdsTemplateClient";
import { formatTemplateName, parseTemplateName, UNSORTED, type TemplateBucket } from "./templateKinds";

/** A stored template, plus the bucket + title the name prefix carries. */
export type MessageTemplate = ManagedTemplate & { bucket: TemplateBucket; title: string };

/** The draft an editor holds. `updatedAt` is the CAS stamp of the row it was
 *  opened from — absent on a create, and what makes a second recruiter's save a
 *  refused 409 instead of a silent overwrite. */
export type MessageDraft = {
  id?: string;
  bucket: TemplateBucket;
  title: string;
  body: string;
  scope: "org" | "team";
  updatedAt?: string;
};

export function emptyDraft(bucket: TemplateBucket = UNSORTED): MessageDraft {
  return { bucket, title: "", body: "", scope: "team" };
}

export function draftOf(tpl: MessageTemplate): MessageDraft {
  return { id: tpl.id, bucket: tpl.bucket, title: tpl.title, body: tpl.body, scope: tpl.scope, updatedAt: tpl.updatedAt };
}

export function useMessageTemplates() {
  const t = useTranslations("templates");
  const errMsg = useErrorMessage();
  // null = not loaded yet; [] = genuinely empty. Keeping them distinct is what
  // lets the list say "nothing here yet" without ever saying it about a library
  // whose load simply failed.
  const [rows, setRows] = useState<ManagedTemplate[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const page = await loadManagedTemplates();
      setRows(page.templates);
      setTruncated(page.truncated);
      setLoadFailed(false);
    } catch {
      // Not an empty catch: the flag IS the handling. The surface renders the
      // failure line and a retry rather than an empty-library claim.
      setLoadFailed(true);
    }
  }, []);

  // Deferred kickoff — no synchronous setState in an effect body, the shape the
  // library hooks already use.
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const templates = useMemo<MessageTemplate[] | null>(
    () => rows?.map((r) => ({ ...r, ...parseTemplateName(r.name) })) ?? null,
    [rows]
  );

  /** Save a draft (create or edit). Returns true when the row landed, so a caller
   *  can close its editor only on success. */
  const save = useCallback(
    async (draft: MessageDraft): Promise<boolean> => {
      const name = formatTemplateName(draft.bucket, draft.title);
      // The same validator the write boundary runs, so the form refuses locally
      // with the identical rule instead of a round-trip 400.
      const fields = validateTemplateFields(name, draft.body);
      if (!fields.ok) {
        setError(t("errInvalid"));
        return false;
      }
      // Unknown {{tokens}} are BLOCKED by the API (renderTemplate's policy) —
      // say so here rather than letting the save bounce.
      if (findUnknownPlaceholders(fields.body).length) {
        setError(t("errUnknownTokens"));
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const { outcome, body } = await sendTemplateWrite(
          templateSaveRequest({ id: draft.id, scope: draft.scope, updatedAt: draft.updatedAt }, fields)
        );
        if (outcome === "gate") {
          setError(t("errNotPermitted"));
          return false;
        }
        if (outcome !== "ok") {
          setError(errMsg(body, t("errSaveFailed")));
          return false;
        }
        await reload();
        return true;
      } catch {
        setError(t("errSaveFailed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [errMsg, reload, t]
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const { outcome, body } = await sendTemplateWrite({
          url: `/api/templates/${encodeURIComponent(id)}`,
          method: "DELETE",
        });
        if (outcome === "gate") {
          setError(t("errNotPermitted"));
          return false;
        }
        // TEMPLATE_LAST_ONE / TEMPLATE_IS_DEFAULT / TEMPLATE_NOT_FOUND all resolve
        // from the code, in the reader's language.
        if (outcome !== "ok") {
          setError(errMsg(body, t("errDeleteFailed")));
          return false;
        }
        await reload();
        return true;
      } catch {
        setError(t("errDeleteFailed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [errMsg, reload, t]
  );

  return { templates, loadFailed, truncated, busy, error, setError, reload, save, remove };
}

/** The hook's surface, so the tab can own ONE instance and hand it to whichever
 *  variant is mounted — switching prototype does not re-fetch the library. */
export type TemplatesStore = ReturnType<typeof useMessageTemplates>;
