import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasEnteredWorkspace } from "@/app/_lib/auth/home-gate-server";
import { signupEnabled } from "@/app/_lib/workspace-lock";
import { LoginClient } from "./LoginClient";
import { safeNextPath } from "./login-result";

// The sign-in form renders under the per-request locale layout (useTranslations
// reads the provider's messages, which the layout resolves per request), so it
// can't be statically prerendered under Cache Components. Block it. `instant` is
// route segment config, so it lives on this Server Component wrapper; the form
// stays in the "use client" LoginClient child.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // /login is public, so the proxy will not bounce a signed-in operator who
  // follows a bookmark. Skip the form when they have already entered.
  if (await hasEnteredWorkspace()) {
    const sp = await searchParams;
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost").split(",")[0]!.trim();
    const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
    const origin = `${proto}://${host}`;
    const raw = sp?.next;
    const next = typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
    const rawPlan = sp?.plan;
    const plan = typeof rawPlan === "string" ? rawPlan : Array.isArray(rawPlan) ? (rawPlan[0] ?? "") : "";
    const intent = new URLSearchParams();
    if (next) intent.set("next", next);
    if (plan) intent.set("plan", plan);
    redirect(safeNextPath(intent.toString(), origin));
  }
  // Same server-resolved bit the landing hero uses: /signup 404s when the flag
  // is off, so the client must never guess from a public env mirror.
  return <LoginClient signupOpen={signupEnabled()} />;
}
