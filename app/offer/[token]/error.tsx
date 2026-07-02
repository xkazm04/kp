"use client";

// Route-level error boundary for /offer/[token] — the candidate's accept/decline offer card — the highest-stakes public page.
// Why here: client page fetches its data itself, but a render crash (bad payload shape, a bug in the countdown) must not strand the candidate on Next's default screen.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
