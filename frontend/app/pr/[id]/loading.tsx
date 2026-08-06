/**
 * Loading fallback for a finished PR analysis.
 *
 * A plain skeleton, not the pipeline stepper — we are fetching a stored result,
 * not re-running analysis. The live stepper lives on the /analyze route.
 */
function Block({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-panel ${className ?? ''}`} />;
}

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-12 border-b border-line" />
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
        <Block className="h-20 w-full" />
        <Block className="h-52 w-full" />
        <Block className="h-40 w-full" />
        <Block className="h-32 w-full" />
      </div>
    </div>
  );
}
