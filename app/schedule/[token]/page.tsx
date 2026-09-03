import { getTranslations } from "next-intl/server";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { LanguageSwitcher } from "@/app/_components/LanguageSwitcher";
import { SchedulePicker } from "./SchedulePicker";


// Candidate-facing self-scheduling page (tokenized). Picking a slot books the
// interview and triggers a confirmation + reminder.
// Blocked under Cache Components: dynamic per-request route (previously
// force-dynamic) with no useful static shell to prerender.
export const instant = false;

export default async function SchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("schedule");
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      {/* The candidate's own escape hatch, mirroring the apply / status / offer / data
          pages: the invite link is now ?lang=-pinned, but a forwarded link, a link
          re-opened weeks later, or a stale NEXT_LOCALE cookie from an earlier visit can
          still land them in a language they don't read — and this page has no other
          chrome to change it from. */}
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
      <h1 className="mt-1 font-serif text-display text-ink">{t("title")}</h1>
      <p className="mt-2 text-body text-steel">{t("intro")}</p>
      <div className="mt-6">
        <SchedulePicker token={token} />
      </div>
      <AiDisclosure className="mt-6" />
    </main>
  );
}
