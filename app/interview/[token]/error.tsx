"use client";

// Route-level error boundary for /interview/[token] — the candidate voice-interview portal (force-dynamic, sqlite-backed session lookup).
// Why here: getInterviewSessionByToken can throw on a DB fault (SQLITE_BUSY, disk) — the candidate gets a retry panel, not an unstyled 500.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
