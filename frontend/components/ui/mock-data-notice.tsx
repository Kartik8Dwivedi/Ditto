'use client';

import { isUsingMockData } from '@/services/ditto.api';
import { Badge } from './badge';
import { Tooltip } from './tooltip';

/**
 * Says out loud when the screen is rendering fixtures rather than a live
 * analysis.
 *
 * Same principle as the EXECUTED / PREDICTED badge: the app should never let
 * you believe it did work it did not do. Point `NEXT_PUBLIC_DITTO_SOURCE=api`
 * at a running backend and this disappears on its own.
 */
export function MockDataNotice() {
  if (!isUsingMockData) return null;

  return (
    <Tooltip
      align="end"
      label={
        <>
          This screen is rendering <strong className="text-warn">demo fixtures</strong>, not a live
          analysis of a real repository. The divergence tables are real recorded output from running
          these functions — but the repo itself is a fixture.
        </>
      }
    >
      <Badge tone="warn" dashed>
        Fixtures
      </Badge>
    </Tooltip>
  );
}
