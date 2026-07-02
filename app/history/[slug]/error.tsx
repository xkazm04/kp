"use client";

// Route-level error boundary for /history/[slug] — the saved analysis report (force-dynamic, sqlite-backed).
// Why here: the page already hand-guards loadAnalysis, but anything past that guard (schema drift in a subcomponent, ResultPanel render bugs) lands here instead of Next's default.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
