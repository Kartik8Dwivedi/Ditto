'use client';

import { Fragment, useState } from 'react';
import { cn } from '@/lib/utils';
import { TOKEN_COLOR, tokenizeLines } from '@/lib/highlight';

/**
 * Syntax-highlighted source, gutter-numbered from the real line in the source
 * file so a reader can go and find it.
 */
export function CodeBlock({
  code,
  startLine = 1,
  className,
}: {
  code: string;
  startLine?: number;
  className?: string;
}) {
  const lines = tokenizeLines(code.replace(/\n$/, ''));
  const [expanded, setExpanded] = useState(false);
  const collapsible = lines.length > 20;
  const visibleLines = collapsible && !expanded ? lines.slice(0, 20) : lines;
  const gutterWidth = String(startLine + lines.length - 1).length;

  return (
    <pre
      className={cn('overflow-x-auto bg-inset font-mono text-[12px] leading-[1.6] text-ink', className)}
    >
      <code className="block min-w-max py-2">
        {visibleLines.map((tokens, index) => (
          <div key={index} className="flex px-3 hover:bg-line/40">
            <span
              aria-hidden
              className="tnum mr-3 shrink-0 select-none text-right text-ink-subtle/60"
              style={{ width: `${gutterWidth}ch` }}
            >
              {startLine + index}
            </span>
            <span className="flex-1 whitespace-pre">
              {tokens.length === 0
                ? ' '
                : tokens.map((token, tokenIndex) => (
                    <Fragment key={tokenIndex}>
                      {token.kind === 'plain' ? (
                        token.text
                      ) : (
                        <span style={{ color: TOKEN_COLOR[token.kind] }}>{token.text}</span>
                      )}
                    </Fragment>
                  ))}
            </span>
          </div>
        ))}
      </code>
      {collapsible && (
        <button
          type="button"
          className="mx-3 mb-2 text-xs text-accent hover:underline"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show full function'}
        </button>
      )}
    </pre>
  );
}
