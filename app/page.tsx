import { Suspense } from "react";
import { Workspace } from "@/app/_components/workspace/Workspace";

export default function Home() {
  return (
    <main className="min-h-screen bg-paper">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-stone-300 pb-5">
          <div>
            <p className="text-meta uppercase text-coral">KP Case Study</p>
            <h1 className="mt-2 font-serif text-display text-ink">Job Fit & Salary Estimator</h1>
            <p className="mt-2 max-w-3xl text-body text-steel">
              Analyze a CV or LinkedIn PDF export for overall seniority. Attach a job description
              when you want role-fit, missing skills, and salary-positioning output. Save analyses
              and JDs to the workspace, then compare candidates in the matrix view.
            </p>
          </div>
        </header>

        <Suspense fallback={<div className="h-10 animate-pulse rounded-lg bg-stone-100" />}>
          <Workspace />
        </Suspense>
      </div>
    </main>
  );
}
