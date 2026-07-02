"use client";

// Route-level error boundary for /schedule/[token] — the candidate self-scheduling page (force-dynamic server render).
// Why here: a server-side crash while building the page (translations, streaming) renders the branded retry panel.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
