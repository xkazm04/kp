import { getTranslations } from "next-intl/server";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { SchedulePicker } from "./SchedulePicker";

export const dynamic = "force-dynamic";

// Candidate-facing self-scheduling page (tokenized). Picking a slot books the
// interview and triggers a confirmation + reminder.
export default async function SchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("schedule");
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
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
