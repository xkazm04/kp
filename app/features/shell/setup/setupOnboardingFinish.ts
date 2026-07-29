// The "persist everything the wizard collected" body of OnboardingExperience's
// finish(), split out so the component stays under the 200-line file cap.
// Verbatim logic — same best-effort-per-step contract (a failing invite must not
// sink the rest); throws are left for the caller's try/catch to turn into the
// generic "partial" toast.
import type { useTranslations } from "next-intl";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { toast } from "@/app/_components/toast-store";
import { roleDraftReady, roleImportReady, type SetupState } from "./setupSteps";

export async function persistOnboardingSetup(state: SetupState, t: ReturnType<typeof useTranslations>): Promise<void> {
  const name = state.orgName.trim();
  if (name) await setOrgName(name);
  await setOrgLanguage(state.language);

  // Brand (optional): merge over the current config — PUT replaces the whole
  // record, and onboarding must not clobber a displayName set elsewhere.
  const logo = state.logoUrl.trim();
  if (state.accentColor || logo) {
    try {
      const current = (await fetch("/api/brand").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as {
        displayName?: string | null;
        accentColor?: string | null;
        logoUrl?: string | null;
      } | null;
      await fetch("/api/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: current?.displayName ?? null,
          accentColor: state.accentColor ?? current?.accentColor ?? null,
          logoUrl: logo || current?.logoUrl || null,
        }),
      });
    } catch {
      /* brand is a nice-to-have — the rest of the setup still lands */
    }
  }

  await Promise.allSettled(
    state.invites.map((inv) =>
      fetch("/api/org/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      })
    )
  );

  // First role. Import mode saves the EXISTING description as-is (POST
  // /api/jds) and best-effort ingests it as a matchable job — no AI build.
  // Write mode starts the REAL backgrounded build (same endpoint as the
  // Library's Generate): description + market salary + case design in one
  // run, appearing in the ledger as "Analyzing" immediately.
  if (state.role.mode === "import" && roleImportReady(state.role)) {
    try {
      const res = await fetch("/api/jds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: state.role.title.trim(), body: state.role.importedBody.trim() }),
      });
      if (res.ok) {
        const saved = (await res.json().catch(() => null)) as { slug?: string } | null;
        if (saved?.slug) {
          await fetch(`/api/jds/${saved.slug}/ingest-job`, { method: "POST" }).catch(() => {});
        }
        toast.success(t("toast.roleImported"));
      } else {
        toast.error(t("toast.roleFailed"));
      }
    } catch {
      toast.error(t("toast.roleFailed"));
    }
  } else if (state.role.mode === "write" && roleDraftReady(state.role)) {
    try {
      const res = await fetch("/api/jds/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.role.title.trim(),
          company: name || undefined,
          seniority: state.role.seniority,
          roleFamily: state.role.roleFamily,
          needText: state.role.needText.trim(),
          // The build renders en/cs only — other app languages fall back to en.
          lang: state.language === "cs" ? "cs" : "en",
          options: { description: true, marketResearch: true, caseDesign: true },
        }),
      });
      if (res.ok) {
        toast.success(t("toast.roleStarted"));
      } else {
        toast.error(t("toast.roleFailed"));
      }
    } catch {
      toast.error(t("toast.roleFailed"));
    }
  }
  toast.success(t("toast.saved"));
}
