import { Suspense } from "react";
import { Workspace } from "@/app/features/Workspace";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <Workspace />
    </Suspense>
  );
}
