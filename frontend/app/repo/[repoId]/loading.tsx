/**
 * Loading fallback for the map of an ALREADY-analysed repo.
 *
 * Deliberately a plain skeleton, not the pipeline stepper — we are fetching
 * cached results, not re-running analysis, and showing "Parsing AST…" here
 * would falsely imply a fresh run (which matters on a cold-start). The real
 * pipeline stepper lives on the /analyze route.
 */
function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-panel ${className ?? ''}`} />;
}

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-12 border-b border-line" />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8 lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 lg:w-[280px]">
          <Block className="h-10 w-full" />
          <Block className="h-28 w-full" />
          <Block className="h-56 w-full" />
        </aside>
        <main className="min-w-0 flex-1 space-y-6">
          <Block className="h-24 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Block key={i} className="h-11 w-full" />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
