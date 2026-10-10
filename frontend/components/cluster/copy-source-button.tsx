'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopySourceButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(source);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or permission denied.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopySource}
      aria-label={copied ? 'Source copied' : 'Copy source code'}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink transition hover:bg-inset"
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}