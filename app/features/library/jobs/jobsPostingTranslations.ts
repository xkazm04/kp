"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

// The posting tab's OTHER languages: what exists, and the door that makes one.
//
// The modal builds the posting's SCAFFOLDING in any of the four locales already —
// headings, the salary unit, the enum labels — from the catalogs. What it cannot
// build is the role's own prose: the description a recruiter wrote and the
// requirement skills, which stay in the language they were authored in whatever the
// heading above them says. That is why a language other than the posting's own
// needs a real translation rather than a re-render, and why one that has not been
// generated shows an EMPTY STATE instead of a document that is half Czech.
//
// KEYLESS: the generate door answers JOB_TRANSLATION_UNAVAILABLE (503) when no
// model is configured, and nothing is stored. The empty state stays and the reader
// is told why, in their own language, through `errors.*` — never through the
// server's English string.

export type PostingTranslation = { lang: string; sourceLang: string; bodyMd: string; createdAt: string };

export type PostingTranslationsState = {
  /** The languages the ROLE was opened in — the chips worth offering beyond the
   *  four the app can render. Empty until the read lands, or for a role that never
   *  named any. */
  roleLangs: Locale[];
  /** The language the posting itself is written in; the app default until known. */
  sourceLang: Locale;
  /** lang → stored body. */
  byLang: Record<string, PostingTranslation>;
  /** The language currently being generated, or null. */
  generating: string | null;
  /** The last generate failure, already resolved into the reader's language. */
  error: string | null;
  /** True while the initial read is in flight (nothing is known yet). */
  loading: boolean;
  generate: (lang: Locale) => void;
};

type Payload = { langs?: unknown; sourceLang?: unknown; translations?: unknown };

/** Read a `/api/jobs/[id]/translations` body into state. Exported for its own test:
 *  a malformed or older payload must degrade to "nothing known", never to a crash
 *  inside the modal that is rendering a live posting. */
export function readTranslationsPayload(body: unknown): {
  roleLangs: Locale[];
  sourceLang: Locale | null;
  byLang: Record<string, PostingTranslation>;
} {
  const payload = (body ?? {}) as Payload;
  const roleLangs = Array.isArray(payload.langs) ? payload.langs.filter((l): l is Locale => isLocale(l)) : [];
  const rows = Array.isArray(payload.translations) ? payload.translations : [];
  const byLang: Record<string, PostingTranslation> = {};
  for (const row of rows) {
    const tr = row as Partial<PostingTranslation>;
    if (typeof tr.lang !== "string" || typeof tr.bodyMd !== "string" || !tr.bodyMd.trim()) continue;
    byLang[tr.lang] = {
      lang: tr.lang,
      sourceLang: typeof tr.sourceLang === "string" ? tr.sourceLang : "",
      bodyMd: tr.bodyMd,
      createdAt: typeof tr.createdAt === "string" ? tr.createdAt : "",
    };
  }
  return { roleLangs, sourceLang: isLocale(payload.sourceLang) ? payload.sourceLang : null, byLang };
}

export function usePostingTranslations(jobId: string, fallbackSourceLang: Locale = DEFAULT_LOCALE): PostingTranslationsState {
  const resolveError = useErrorMessage();
  // The fallback sentence for a failure that carries no code at all (a transport
  // error). Every coded failure — the keyless refusal included — resolves through
  // `errors.<CODE>` instead.
  const t = useTranslations("jobs.posting");
  const [roleLangs, setRoleLangs] = useState<Locale[]>(() => []);
  const [sourceLang, setSourceLang] = useState<Locale | null>(null);
  const [byLang, setByLang] = useState<Record<string, PostingTranslation>>(() => ({}));
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // A real cancellation, not a boolean: closing the modal mid-read frees the
    // connection instead of leaving it to decode a payload nobody will render.
    // `loading` starts true and is only ever turned OFF here. Setting it back to
    // true at the top of the effect would be a synchronous setState inside an
    // effect body (a cascading render, and a lint error), and it would buy nothing:
    // this hook is mounted per open role — the posting modal remounts when the
    // recruiter opens a different one — so the effect runs exactly once per id.
    const controller = new AbortController();
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/translations`, { signal: controller.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as unknown;
        if (controller.signal.aborted || !r.ok) return;
        const next = readTranslationsPayload(body);
        setRoleLangs(next.roleLangs);
        setSourceLang(next.sourceLang);
        setByLang(next.byLang);
      })
      .catch(() => {
        /* best-effort: a failed read leaves every language in its empty state, which already offers the generate action */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [jobId]);

  const generate = useCallback(
    (lang: Locale) => {
      setGenerating((current) => current ?? lang);
      setError(null);
      void (async () => {
        try {
          const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/translations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang }),
          });
          const body = (await r.json().catch(() => null)) as { code?: string; translation?: unknown } | null;
          if (!r.ok || !body?.translation) {
            // The server's `error` string is NEVER rendered — the code is resolved
            // through the reader's own catalog (api-contracts.md §1.1). The keyless
            // refusal arrives here as JOB_TRANSLATION_UNAVAILABLE.
            setError(resolveError(body, t("translateFailed")));
            return;
          }
          const tr = body.translation as Partial<PostingTranslation>;
          const bodyMd = typeof tr.bodyMd === "string" ? tr.bodyMd : "";
          if (bodyMd.trim()) {
            setByLang((prev) => ({
              ...prev,
              [lang]: {
                lang,
                sourceLang: typeof tr.sourceLang === "string" ? tr.sourceLang : "",
                bodyMd,
                createdAt: typeof tr.createdAt === "string" ? tr.createdAt : "",
              },
            }));
          }
        } catch {
          // A transport failure carries no code; the generic sentence is the honest one.
          setError(resolveError(null, t("translateFailed")));
        } finally {
          setGenerating(null);
        }
      })();
    },
    [jobId, resolveError, t]
  );

  return {
    roleLangs,
    sourceLang: sourceLang ?? fallbackSourceLang,
    byLang,
    generating,
    error,
    loading,
    generate,
  };
}
