"use client";

import type { useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/locales";
import { Select } from "@/app/_components/Select";
import { TextInput } from "@/app/_components/TextInput";
import { isOutputLang, JD_OUTPUT_LANGS, SENIORITIES } from "./jdsBuilderLogic";

// A labeled form field wrapper — used throughout JdsBuilder.tsx.
export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-steel">{label}</span>
      {children}
    </label>
  );
}

// The title/company/seniority/field/output-language grid — extracted verbatim
// from JdsBuilder.tsx so that file stays under the 200-line split threshold.
export function JdsBuilderFieldsGrid({
  t,
  enumLabel,
  title,
  setTitle,
  company,
  setCompany,
  seniority,
  setSeniority,
  roleFamily,
  setRoleFamily,
  familyOptions,
  outputLang,
  setOutputLang,
}: {
  t: ReturnType<typeof useTranslations<"library.builder">>;
  enumLabel: (cat: string, value: string | null | undefined) => string;
  title: string;
  setTitle: (v: string) => void;
  company: string;
  setCompany: (v: string) => void;
  seniority: string;
  setSeniority: (v: string) => void;
  roleFamily: string;
  setRoleFamily: (v: string) => void;
  familyOptions: { value: string; label: string }[];
  outputLang: string;
  setOutputLang: (v: (typeof JD_OUTPUT_LANGS)[number]) => void;
}) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <Field label={t("roleTitle")}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("roleTitlePlaceholder")} sizeVariant="sm" />
      </Field>
      <Field label={t("company")}>
        <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("companyPlaceholder")} sizeVariant="sm" />
      </Field>
      <Field label={t("seniority")}>
        <Select
          ariaLabel={t("seniority")}
          value={seniority}
          onChange={setSeniority}
          sizeVariant="sm"
          className="w-full"
          options={SENIORITIES.map((s) => ({ value: s, label: enumLabel("seniority", s) }))}
        />
      </Field>
      <Field label={t("field")}>
        <Select
          ariaLabel={t("field")}
          value={roleFamily}
          onChange={setRoleFamily}
          sizeVariant="sm"
          className="w-full"
          searchable
          options={familyOptions}
        />
      </Field>
      {/* JDL5 — generate the JD in this language (defaults to the app locale).
          Only en/cs are honest end-to-end (see the outputLang note above); de/fr
          render disabled so the recruiter never silently gets an English JD. */}
      <Field label={t("outputLanguage")}>
        <Select
          ariaLabel={t("outputLanguage")}
          value={outputLang}
          onChange={(v) => setOutputLang(isOutputLang(v) ? v : "en")}
          sizeVariant="sm"
          className="w-full"
          options={LOCALES.map((l) =>
            isOutputLang(l)
              ? { value: l, label: l.toUpperCase() }
              : { value: l, label: t("outputLangUnavailable", { lang: l.toUpperCase() }), disabled: true }
          )}
        />
      </Field>
    </div>
  );
}
