"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useKitFlag } from "@/app/_components/kit/useKitFlag";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";

// Gate K2 (kit-unification spark, dev only): `?kit=1` renders the composition-kit port of the
// Channels tab. Its code and CSS load only behind the flag (a dynamic chunk); production always
// renders `current`, the tab as it is today.
const ChannelsKitView = dynamic(() => import("./ChannelsKitView"), {
  loading: () => <LoadingGap className="min-h-[28rem]" />,
});

export function ChannelsKitSwitch({ current }: { current: ReactNode }) {
  return useKitFlag() ? <ChannelsKitView /> : current;
}
