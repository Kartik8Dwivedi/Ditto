# Security Policy

Ditto executes untrusted repository code in a sandbox (`worker_threads` + a fresh
`vm` context, no filesystem, no network, 1-second timeout — see [DESIGN.md](DESIGN.md)),
so isolation issues are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability.

Instead, report it privately via GitHub's
[**Report a vulnerability**](../../security/advisories/new) flow (Security → Advisories),
or by email to **[codewithme.kartik@gmail.com]**.

Please include a description, reproduction steps, and the impact you expect. We aim to
acknowledge within 72 hours and to keep you updated as we work on a fix.

## Scope

Most relevant to Ditto:

- Sandbox escape from the execution probe (reaching the filesystem, network, or host
  process from inside the `vm` context).
- Resource exhaustion that the per-call and per-worker timeouts fail to bound.
- Any path that causes the server to make requests or run code an operator did not intend.

Thank you for helping keep Ditto and its users safe.
