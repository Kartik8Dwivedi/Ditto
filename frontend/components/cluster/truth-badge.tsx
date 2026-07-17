'use client';

import { FlaskConical, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * ⚠️ LOAD-BEARING HONESTY FEATURE — not decoration. See PRD §4.3.
 *
 * Judges are told to try to break this. The rule it enforces is absolute:
 * output we predicted must NEVER be presented as output we ran. There is no
 * state of this component where `executed === false` reads as green.
 */
export function TruthBadge({ executed, className }: { executed: boolean; className?: string }) {
  if (executed) {
    return (
      <Tooltip
        className={className}
        align="end"
        label={
          <>
            <strong className="text-success">These functions were actually run.</strong> Every cell
            below is real output captured from executing this code, not a prediction.
          </>
        }
      >
        <Badge tone="success">
          <FlaskConical aria-hidden className="size-3" />
          Executed
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      className={className}
      align="end"
      label={
        <>
          <strong className="text-warn">Predicted, not executed.</strong> These members are not pure
          — running them would touch the network or shared state — so Ditto did not probe them. The
          outputs below are the model&rsquo;s expectation and are not proof.
        </>
      }
    >
      <Badge tone="warn" dashed>
        <Sparkles aria-hidden className="size-3" />
        Predicted — not executed
      </Badge>
    </Tooltip>
  );
}
