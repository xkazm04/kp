"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { useCopyState } from "../../useCopyState";

/**
 * A receiver's endpoint, handled as the credential it is: masked until the reader reveals it,
 * copied whole either way. The copy answers Copied / Copy failed on its own button
 * and to a screen reader (useCopyState: a blocked clipboard must never look like a copy, or the
 * recruiter pastes a stale endpoint into a forwarding rule and loses applications silently). A
 * failed copy reveals the value, since the reader is now told to select it.
 */
export function SetupEndpoint({ label, role, value, masked, revealed, onReveal }: {
  label: string;
  role: string;
  value: string;
  masked: string;
  revealed: boolean;
  onReveal: (next: boolean) => void;
}) {
  const t = useTranslations("channelsNight.setup.endpoint");
  const tc = useTranslations("channels");
  const { state, copy } = useCopyState();
  // "Copy failed. Select the text." is an instruction: the text it points at must be readable.
  useEffect(() => {
    if (state === "failed") onReveal(true);
  }, [state, onReveal]);
  return (
    <div className="cns-endpoint">
      <span className="cns-field__label">{label}</span>
      <code className="cns-endpoint__value" data-masked={revealed ? undefined : "1"}>
        {revealed ? value : masked}
      </code>
      {revealed ? null : <span className="sr-only">{t("masked")}</span>}
      <span className="cns-endpoint__acts">
        <Button
          label={revealed ? t("hide") : t("reveal")}
          aria-label={revealed ? t("hideAria", { role }) : t("revealAria", { role })}
          size="sm"
          onClick={() => onReveal(!revealed)}
        />
        <Button
          label={state === "copied" ? tc("copied") : state === "failed" ? tc("copyFailed") : tc("copy")}
          aria-label={t("copyAria", { role })}
          icon={state === "copied" ? "check" : state === "failed" ? "x" : "copy"}
          size="sm"
          onClick={() => copy(value)}
        />
      </span>
      <span className="sr-only" role="status">
        {state === "copied" ? tc("copied") : state === "failed" ? tc("copyFailed") : ""}
      </span>
    </div>
  );
}
