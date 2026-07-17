# Fixture audit

These fixtures make claims a judge can check. `audit.mjs` checks them first.

```bash
cd frontend && node lib/mocks/audit.mjs
```

It fails the build of trust on any of:

- `diverged: true` on a row whose outputs are all identical (or `diverged: false`
  on a row where they differ) — a table that says "they disagree" while showing
  four identical cells is the exact thing we are asking judges to look for.
- `loc` disagreeing with the real line count of `body`, or
  `endLine - startLine + 1` disagreeing with `loc`.
- `memberCount` disagreeing with `members.length`.
- Zero or several members marked `isCanonical`.
- A `results[].functionId` that matches no member, or a row that does not cover
  every member.
- Duplicate ids, or an empty `differences`.
- `hasProvenDivergence: true` on a cluster whose divergence was not executed —
  predicted is not proven.

Run it after touching any fixture.
