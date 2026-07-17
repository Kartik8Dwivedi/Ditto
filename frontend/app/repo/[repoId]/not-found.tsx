import Link from 'next/link';
import { Search } from 'lucide-react';

export default function RepoNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center gap-2">
          <Search aria-hidden className="size-4 text-ink-subtle" />
          <h1 className="font-mono text-[13px] font-semibold text-ink">Repository not indexed</h1>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Ditto has not analysed this repository, so there are no findings to show. It may not exist,
          it may be private, or it may simply never have been indexed.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-mono text-[12px] text-ink transition-colors duration-150 hover:bg-inset"
        >
          Pick an indexed repository
        </Link>
      </div>
    </div>
  );
}
