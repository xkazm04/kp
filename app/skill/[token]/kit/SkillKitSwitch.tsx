"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useKitFlag } from "@/app/_components/kit/useKitFlag";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import type { SkillKitCard } from "./skillKitModel";

// Gate 2 (kit-unification spark, dev only): `?kit=1` renders the composition-kit credential. The
// server page renders `current` exactly as before and hands the kit view the same facts as plain
// props, so the switch never refetches. The server snapshot of the flag is false, so the HTML the
// server sends (and a print of it) is always today's page; the kit view and its CSS load only
// behind the flag.
const SkillKitView = dynamic(() => import("./SkillKitView"), {
  loading: () => <LoadingGap className="min-h-[28rem]" />,
});

export function SkillKitSwitch({ current, card }: { current: ReactNode; card: SkillKitCard }) {
  return useKitFlag() ? <SkillKitView card={card} /> : current;
}
