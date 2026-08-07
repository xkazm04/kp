"use client";

// Route-level error boundary for /devcase/apply/[token] — the candidate-facing dev-case assignment page (force-dynamic, sqlite-backed posting lookup).
// Why here: getPostingByToken/getDevCase run sqlite reads server-side; a fault renders the branded retry panel.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
