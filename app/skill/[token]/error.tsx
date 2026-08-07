"use client";

// Route-level error boundary for /skill/[token] — the public shareable Skill Profile credential (force-dynamic, sqlite-backed verification).
// Why here: verifySkillProfileToken runs a sqlite read server-side; a fault renders the branded retry panel on a link candidates share externally.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
