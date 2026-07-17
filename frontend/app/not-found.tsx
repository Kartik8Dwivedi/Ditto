import Link from 'next/link';
import { DittoMark } from '@/components/ui/ditto-mark';

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center gap-2">
          <DittoMark className="size-4 text-ink-subtle" />
          <h1 className="font-mono text-[13px] font-semibold text-ink">Page not found</h1>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          There is nothing at this address.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink transition-colors duration-150 hover:bg-inset"
        >
          Back to Ditto
        </Link>
      </div>
    </main>
  );
}
