'use client';

import { useState } from 'react';
import { Clipboard, Download } from 'lucide-react';
import type { RepoDetail } from '@/types/ditto';
import { buildRepoReport, reportFilename } from '@/lib/repo-report';
import { isUsingMockData } from '@/services/ditto.api';

/** Hands the browser a file straight from memory — no backend involved. */
function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can abort the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportReportButton({ report }: { report: RepoDetail }) {
  const [exported, setExported] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    const markdown = buildRepoReport(report, {
      generatedAt: new Date(),
      fromFixtures: isUsingMockData,
    });
    downloadText(reportFilename(report.repo), markdown, 'text/markdown;charset=utf-8');

    setExported(true);

    setTimeout(() => setExported(false), 2000);
  };

  const handleCopy = async () => {
    try {
      const markdown = buildRepoReport(report, {
        generatedAt: new Date(),
        fromFixtures: isUsingMockData,
      });
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable or permission denied.
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        title="Copy these findings as Markdown"
        className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink transition hover:bg-inset"
      >
        <Clipboard aria-hidden className="size-3.5" />
        {copied ? 'Copied!' : 'Copy as Markdown'}
      </button>
      <button
        type="button"
        onClick={handleExport}
        title="Download these findings as a Markdown report"
        className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink transition hover:bg-inset"
      >
        <Download aria-hidden className="size-3.5" />
        {exported ? 'Exported!' : 'Export report'}
      </button>
    </div>
  );
}
