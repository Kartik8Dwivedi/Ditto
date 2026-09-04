'use client';

import { Search, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortOption = 'risk' | 'confidence' | 'members';

export const VERDICT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'Semantic conflict', label: 'Semantic conflict' },
  { value: 'Suspected conflict', label: 'Suspected' },
  { value: 'Cosmetic diff', label: 'Cosmetic' },
  { value: 'Near-duplicate', label: 'Near-duplicate' },
  { value: 'No disagreement', label: 'No disagreement' },
] as const;

interface ClusterToolbarProps {
  search: string;
  onSearchChange: (val: string) => void;
  selectedVerdict: string;
  onVerdictChange: (val: string) => void;
  provenOnly: boolean;
  onProvenOnlyToggle: () => void;
  sortBy: SortOption;
  onSortByChange: (sort: SortOption) => void;
  totalCount: number;
  filteredCount: number;
}

export function ClusterToolbar({
  search,
  onSearchChange,
  selectedVerdict,
  onVerdictChange,
  provenOnly,
  onProvenOnlyToggle,
  sortBy,
  onSortByChange,
  totalCount,
  filteredCount,
}: ClusterToolbarProps) {
  const hasActiveFilters = search.trim() !== '' || selectedVerdict !== 'all' || provenOnly;

  return (
    <div className="mb-3 flex flex-col gap-2.5">

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-1 items-center gap-2">
       
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter by domain or behaviour..."
              className="w-full rounded-md border border-line bg-inset py-1.5 pl-8 pr-7 text-[12px] text-ink placeholder:text-ink-subtle focus:border-line-strong focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                title="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

         
          <button
            type="button"
            onClick={onProvenOnlyToggle}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              provenOnly
                ? 'border-danger-line bg-danger-bg text-danger'
                : 'border-line bg-panel text-ink-muted hover:border-line-strong hover:text-ink',
            )}
            title="Show only clusters with proven divergence in sandbox execution"
          >
            <TriangleAlert className="size-3" />
            <span>They disagree only</span>
          </button>
        </div>

       
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="font-mono text-[10px] tracking-wider text-ink-subtle uppercase">Sort</span>
            <select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as SortOption)}
              className="rounded-md border border-line bg-inset px-2 py-1 text-[11px] text-ink focus:border-line-strong focus:outline-none"
            >
              <option value="risk">Risk (Default)</option>
              <option value="confidence">Confidence</option>
              <option value="members">Members</option>
            </select>
          </div>

          <span className="font-mono text-[11px] text-ink-subtle tnum">
            {filteredCount} of {totalCount} shown
          </span>
        </div>
      </div>

      
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[10px] tracking-wider text-ink-subtle uppercase">Verdict:</span>
        {VERDICT_OPTIONS.map((option) => {
          const isSelected = selectedVerdict === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onVerdictChange(option.value)}
              className={cn(
                'rounded border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider uppercase transition-colors',
                isSelected
                  ? 'border-accent-line bg-accent-bg text-accent'
                  : 'border-line bg-panel text-ink-subtle hover:border-line-strong hover:text-ink',
              )}
            >
              {option.label}
            </button>
          );
        })}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              onSearchChange('');
              onVerdictChange('all');
              if (provenOnly) onProvenOnlyToggle();
            }}
            className="ml-auto text-[11px] text-ink-subtle underline decoration-line hover:text-ink"
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
