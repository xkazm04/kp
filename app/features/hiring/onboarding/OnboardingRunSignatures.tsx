"use client";

// The e-signature (provider seam) section of the onboarding run detail view.
// Split out of OnboardingRunDetailView.tsx to keep that file under the
// 200-line cap.

import { useState } from "react";
import { Check, FileSignature } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import type { Signature } from "./onboardingRunDetailTypes";

export function OnboardingRunSignatures({
  signatures,
  candidateLabel,
  onSign,
  onRequestSign,
}: {
  signatures: Signature[];
  candidateLabel: string | null;
  onSign: (signatureId: string, signer: string) => void;
  onRequestSign: (document: string) => void;
}) {
  const t = useTranslations("onboarding");
  const [doc, setDoc] = useState("");
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <FileSignature size={13} /> {t("signatures")}
      </p>
      <p className="mt-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-meta text-amber-800">{t("signSeamNote")}</p>
      {signatures.length > 0 ? (
        <ul className="mt-3 space-y-2" role="list">
          {signatures.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-base">
              <span className="text-ink">{s.document}</span>
              {s.status === "signed" ? (
                <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase text-moss">
                  <Check size={13} /> {t("signed")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSign(s.id, candidateLabel ?? "Signed")}
                  className="focus-ring rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5"
                >
                  {t("markSigned")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TextInput
          type="text"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          placeholder={t("docPlaceholder")}
          sizeVariant="sm"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          disabled={!doc.trim()}
          onClick={() => {
            onRequestSign(doc);
            setDoc("");
          }}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
        >
          <FileSignature size={14} /> {t("requestSign")}
        </button>
      </div>
    </section>
  );
}
