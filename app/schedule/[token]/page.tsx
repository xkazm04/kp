import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { SchedulePicker } from "./SchedulePicker";

export const dynamic = "force-dynamic";

// Candidate-facing self-scheduling page (tokenized). Picking a slot books the
// interview and triggers a confirmation + reminder.
export default async function SchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <p className="text-meta uppercase text-coral">Interview scheduling</p>
      <h1 className="mt-1 font-serif text-display text-ink">Pick a time</h1>
      <p className="mt-2 text-body text-steel">
        Choose the slot that works best — you&apos;ll get a confirmation straight away and a reminder before the call.
      </p>
      <div className="mt-6">
        <SchedulePicker token={token} />
      </div>
      <AiDisclosure className="mt-6" />
    </main>
  );
}
