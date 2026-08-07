"use client";

// Route-level error boundary for /onboarding/[token] — the new hire's pre-boarding questionnaire.
// Why here: client page fetches its data itself; a render crash gets the branded retry panel instead of a dead end on the candidate's first-day link.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
