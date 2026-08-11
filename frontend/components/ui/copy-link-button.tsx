'use client';

import { useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);

      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or permission denied.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopyLink}
      className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink transition hover:bg-inset"
    >
      <LinkIcon aria-hidden className="size-3.5" />
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  );
}