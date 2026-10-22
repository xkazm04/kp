"use client";

import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ExternalLogoImage } from "@/app/_components/ExternalLogoImage";
import { BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";
import { MAX_LOGO_BYTES } from "@/app/_lib/brand-logo";
import type { BrandConfig } from "@/app/_lib/brand-config";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// The upload half of the logo field, shared by Settings → Branding and the first-run
// Company step (the URL field stays beside it as the alternative). An upload is
// PERSISTED at once — POST /api/brand/logo stores the bytes and points the brand's
// logoUrl at them — so `onChange` hands the new serving URL back to the form, which
// treats it as already saved. The server's refusal arrives as a CODE and is resolved
// into the reader's language (useErrorMessage), never rendered as the server's English.

export const UPLOADED_LOGO_PREFIX = "/api/brand/logo";

export function LogoUpload({
  logoUrl,
  onChange,
  disabled = false,
  showPreview = true,
}: {
  /** The form's current logo value; the preview and Remove show only for an uploaded one. */
  logoUrl: string;
  /** Called with the stored serving URL after an upload, or "" after a removal. */
  onChange: (url: string) => void;
  disabled?: boolean;
  /** False where the host already previews the logo (the first-run step does). */
  showPreview?: boolean;
}) {
  const t = useTranslations("logoUpload");
  const errorMessage = useErrorMessage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const uploaded = logoUrl.startsWith(UPLOADED_LOGO_PREFIX);

  async function send(init: RequestInit, onOk: (saved: BrandConfig) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(UPLOADED_LOGO_PREFIX, init);
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        setError(errorMessage(payload, t("failed")));
        return;
      }
      onOk((await r.json()) as BrandConfig);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | undefined) {
    if (!file) return;
    // The same cap the server enforces, checked early so a wrong file costs no upload.
    // The server's own check (on the bytes read) stays the authority.
    if (file.size > MAX_LOGO_BYTES) {
      setError(errorMessage({ code: "BRAND_LOGO_TOO_LARGE" }, t("failed")));
      return;
    }
    void send({ method: "POST", body: file }, (saved) => {
      setBroken(false);
      onChange(saved.logoUrl ?? "");
    });
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        {showPreview && uploaded && !broken ? (
          <div className={`${PANEL} inline-flex h-12 w-12 items-center justify-center p-1.5`}>
            <ExternalLogoImage src={logoUrl} alt={t("alt")} onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
          </div>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/svg+xml,.png,.svg"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className={`${BTN_SECONDARY} h-9 px-3 text-meta`}>
          <ImageUp size={14} aria-hidden /> {busy ? t("uploading") : uploaded ? t("replace") : t("choose")}
        </button>
        {uploaded ? (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() =>
              void send({ method: "DELETE" }, () => {
                setBroken(false);
                onChange("");
              })
            }
            className={`${BTN_SECONDARY} h-9 px-3 text-meta`}
          >
            <Trash2 size={14} aria-hidden /> {t("remove")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-meta text-steel">{t("rules")}</p>
      {error ? (
        <p role="alert" className="mt-1 text-meta text-coral-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
