"use client";

import { useState } from "react";
import { ClipboardPaste, FileText, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { FileInput } from "@/app/_components/FileInput";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { ACCEPT_EXTENSIONS } from "@/app/_lib/upload-constraints";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { OnboardingCtrl, RoleDraft, RoleMode } from "./setupSteps";
import { Req } from "./SetupRequiredMarker";
import { SetupFirstRoleWriteFields } from "./SetupFirstRoleWriteFields";

// First-role step — the activation moment, with two real doors:
//   WRITE  — collect the inputs of the backgrounded build (finish() POSTs
//            /api/jds/generate with description + market salary + case design
//            all on, same door as a Library Generate).
//   IMPORT — the user already HAS a job description: upload .pdf/.docx/.txt/.md
//            (extracted server-side via /api/extract-text, the CV pipeline's
//            extractor) or paste it, and finish() saves it as-is — skipping the
//            authoring inputs entirely.
// Required fields carry a visual marker + aria-required; the step's Continue is
// gated on them (Skip for now remains the explicit way around).

export function FirstRoleStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.firstRole");
  // Extraction failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const enumLabel = useEnumLabel();
  const role = ctrl.state.role;
  const setRole = (patch: Partial<RoleDraft>) => ctrl.update({ role: { ...role, ...patch } });
  const [extracting, setExtracting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: string; code?: string } | null;
      if (res.ok && data?.text?.trim()) {
        // Derive a starter title from the file name when none is set yet.
        const fromName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
        setRole({ importedBody: data.text.trim(), importedFileName: file.name, title: role.title.trim() || fromName });
      } else {
        setImportError(errMsg(data, t("import.error")));
      }
    } catch {
      setImportError(t("import.error"));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <SegmentedControl<RoleMode>
        label={t("modeLabel")}
        value={role.mode}
        onChange={(mode) => setRole({ mode })}
        options={[
          {
            value: "write",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <PenLine size={14} aria-hidden /> {t("mode.write")}
              </span>
            ),
          },
          {
            value: "import",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <ClipboardPaste size={14} aria-hidden /> {t("mode.import")}
              </span>
            ),
          },
        ]}
      />

      <div>
        <label htmlFor="setup-role-title" className={`${META_LABEL} block`}>
          {t("titleLabel")}
          <Req />
        </label>
        <TextInput
          id="setup-role-title"
          autoFocus={role.mode === "write"}
          aria-required
          value={role.title}
          onChange={(e) => setRole({ title: e.target.value })}
          placeholder={t("titlePlaceholder")}
          className="mt-1"
        />
      </div>

      {role.mode === "write" ? (
        <SetupFirstRoleWriteFields role={role} setRole={setRole} t={t} enumLabel={enumLabel} />
      ) : (
        <>
          <div>
            <span className={`${META_LABEL} block`}>{t("import.fileLabel")}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <FileInput
                accept={ACCEPT_EXTENSIONS}
                buttonLabel={t("import.browse")}
                disabled={extracting}
                onChange={(e) => {
                  void importFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {extracting ? (
                <span role="status" className="text-sm font-medium text-steel">
                  {t("import.extracting")}
                </span>
              ) : role.importedFileName ? (
                <span className={`${CHIP_QUIET} inline-flex items-center gap-1`}>
                  <FileText size={12} aria-hidden className="text-moss" /> {role.importedFileName}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-steel">{t("import.hint")}</p>
            {importError ? (
              <p role="alert" className="mt-1 text-sm text-coral">
                {importError}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="setup-role-import-body" className={`${META_LABEL} block`}>
              {t("import.bodyLabel")}
              <Req />
            </label>
            <TextArea
              id="setup-role-import-body"
              aria-required
              value={role.importedBody}
              onChange={(e) =>
                setRole({ importedBody: e.target.value, importedFileName: e.target.value.trim() ? role.importedFileName : null })
              }
              rows={7}
              placeholder={t("import.bodyPlaceholder")}
              className="mt-1"
            />
            <p className="mt-1 text-sm text-steel">{t("import.note")}</p>
          </div>
        </>
      )}
    </div>
  );
}
