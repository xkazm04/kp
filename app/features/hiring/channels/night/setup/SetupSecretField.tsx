"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Tag, inputClass } from "@/app/_components/kit";
import { useCopyState } from "../../useCopyState";
import { generateSecret } from "./setupModel";
import { SetupField } from "./SetupBits";

/**
 * A write-only secret (a relay's signing secret, an edge's shared secret, a feed's bearer token).
 * The server never returns one, so a STORED secret is a mask, a "Set" tag and "Replace"; nothing
 * typed is ever shown until the reader asks (Show / Hide, a pressed toggle). A relay secret can be
 * generated here: it is shown once, with its own copy, until the save masks it for good. Leaving
 * the field blank keeps the stored secret (the POST omits it); "Keep the stored one" says so.
 * Remount it (a `key`) after a successful save to return to the stored face.
 */
export function SetupSecretField({ label, has, value, onChange, placeholder, keepPlaceholder, generate = false, disabled = false }: {
  label: string;
  /** A secret is stored (unknown = false: the neutral placeholder holds until the read lands). */
  has: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  keepPlaceholder: string;
  generate?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("channelsNight.setup.secret");
  const tc = useTranslations("channels");
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(false);
  const [generated, setGenerated] = useState(false);
  const { state: copyState, copy } = useCopyState();
  const input = useRef<HTMLInputElement>(null);
  // "Replace" hands the field its focus (the reader asked to type).
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (has && !editing && value === "") {
    return (
      <SetupField label={label} help={t("storedHelp")}>
        {({ id, helpId }) => (
          <div className="cns-secret">
            <span className="cns-mask" id={id} role="img" aria-label={t("storedAria", { label })} aria-describedby={helpId}>
              ••••••••••••
            </span>
            <Tag label={t("set")} />
            <Button label={t("replace")} size="sm" disabled={disabled} onClick={() => setEditing(true)} />
          </div>
        )}
      </SetupField>
    );
  }

  return (
    <SetupField label={label} help={generated ? t("generatedOnce") : undefined}>
      {({ id, helpId }) => (
        <>
          <div className="cns-secret">
            <input
              ref={input}
              id={id}
              type={shown ? "text" : "password"}
              className={inputClass("md", "cns-secret__input")}
              value={value}
              placeholder={has ? keepPlaceholder : placeholder}
              autoComplete="new-password"
              spellCheck={false}
              disabled={disabled}
              aria-describedby={helpId}
              onChange={(e) => {
                setGenerated(false);
                onChange(e.target.value);
              }}
            />
            <Button
              label={t("show")}
              tip={shown ? t("hideAria") : t("showAria")}
              aria-pressed={shown}
              size="sm"
              variant="ghost"
              disabled={value === ""}
              onClick={() => setShown((s) => !s)}
            />
            {generate ? (
              <Button
                label={t("generate")}
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onChange(generateSecret());
                  setGenerated(true);
                  setShown(true);
                }}
              />
            ) : null}
            {generated ? (
              <Button
                label={copyState === "copied" ? tc("copied") : copyState === "failed" ? tc("copyFailed") : tc("copy")}
                tip={t("copyGenerated")}
                icon={copyState === "copied" ? "check" : copyState === "failed" ? "x" : "copy"}
                size="sm"
                onClick={() => copy(value)}
              />
            ) : null}
          </div>
          <span className="sr-only" role="status">
            {copyState === "copied" ? tc("copied") : copyState === "failed" ? tc("copyFailed") : ""}
          </span>
          {has && editing ? (
            <Button
              label={t("keep")}
              size="sm"
              variant="link"
              onClick={() => {
                onChange("");
                setGenerated(false);
                setShown(false);
                setEditing(false);
              }}
            />
          ) : null}
        </>
      )}
    </SetupField>
  );
}
