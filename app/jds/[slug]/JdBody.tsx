"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/app/_components/Markdown";

// The JD description card, with an icon-only "copy as Markdown" button pinned to
// its top-right corner (the copy action lives with the content it copies).
// one-language-jd — the flagship public page renders in the VISITOR's locale
// (the server component threads the jdPublic namespace); this client card now
// does too, so its copy button + empty-state stop being hardcoded English while
// the rest of the page speaks the candidate's language.
export function JdBody({ markdown }: { markdown: string }) {
  const t = useTranslations("jdPublic");
  const [copied, setCopied] = useState(false);
  // An empty/whitespace JD rendered a blank white card on the flagship shareable page
  // (and the copy button copied "" with a success check). Show an explicit placeholder
  // and hide copy when there's nothing to copy.
  const hasContent = markdown.trim().length > 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <article className="relative rounded-lg border border-stone-200 bg-white p-6 shadow-panel">
      {hasContent ? (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t("copiedToClipboard") : t("copyMarkdown")}
          title={copied ? t("copied") : t("copyMarkdown")}
          className="focus-ring absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-coral"
        >
          {copied ? <Check size={15} className="text-moss" /> : <Copy size={15} />}
        </button>
      ) : null}
      <div className="pr-8">
        {hasContent ? (
          <Markdown content={markdown} />
        ) : (
          <p className="text-sm italic text-steel">{t("noDescriptionYet")}</p>
        )}
      </div>
    </article>
  );
}
