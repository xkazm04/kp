"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Message } from "../../channelsCommsHelpers";
import { useCopyState } from "../../useCopyState";
import { letterMailto, letterPlainText } from "./letterHandSend";

/**
 * Send it yourself: copy the letter, or open it in the reader's own mail program, addressed and
 * titled from what this view already holds. Neither writes anything: the record keeps its state,
 * and the help line says so. A body too long for a `mailto:` link opens with the subject only and
 * is copied to the clipboard instead; whether that copy landed is said out loud (useCopyState: a
 * blocked clipboard must never look like a copy).
 */
export function ChannelsNightHandSend({ message: m }: { message: Message }) {
  const t = useTranslations("channelsNight.message.act.hand");
  const tc = useTranslations("channels");
  const letter = useCopyState();
  const spill = useCopyState();
  const text = letterPlainText(m);
  const mail = letterMailto(m);
  // "Copied" clears itself after a beat; the instruction to paste must stand while the mail
  // program is open, so the landing is remembered (and forgotten again on a failed attempt).
  const [cutLanded, setCutLanded] = useState(false);
  if (spill.state === "copied" && !cutLanded) setCutLanded(true);
  if (spill.state === "failed" && cutLanded) setCutLanded(false);

  const openMail = () => {
    if (mail.cut) spill.copy(text);
    window.location.href = mail.href;
  };

  return (
    <div className="cn-door">
      <div className="cn-door__row">
        <Button
          label={letter.state === "copied" ? tc("copied") : letter.state === "failed" ? tc("copyFailed") : t("copy")}
          icon={letter.state === "copied" ? "check" : letter.state === "failed" ? "x" : "copy"}
          onClick={() => letter.copy(text)}
        />
        <Button label={t("mail")} icon="open" onClick={openMail} />
      </div>
      <p className="cn-door__help">{t("help")}</p>
      <p className="cn-door__said" role="status" data-adverse={spill.state === "failed" ? "1" : undefined}>
        {spill.state === "failed" ? t("cutFailed") : cutLanded ? t("cutCopied") : ""}
      </p>
      <span className="sr-only" role="status">
        {letter.state === "copied" ? tc("copied") : letter.state === "failed" ? tc("copyFailed") : ""}
      </span>
    </div>
  );
}
