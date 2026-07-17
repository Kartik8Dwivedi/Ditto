import { scanFreeIdentifiers, type FileScope } from './purity.js';

/**
 * EXECUTION PREAMBLE — what a pure function needs around it to actually run.
 *
 * Purity allows a function to read module-level state and call same-file
 * helpers. That is the right rule (it is what keeps `currencyToAmount` in the
 * index) but it leaves the body alone unable to execute: the sandbox has never
 * heard of `getNumberFormat`. Without this, the prober would run the function,
 * collect a ReferenceError from every member, and report them as "agreeing" —
 * a table that is technically executed and completely meaningless.
 *
 * So we ship the declarations along with the function. The preamble is for the
 * sandbox only; `body` stays exactly what the extractor read, because that is
 * what gets shown on screen.
 */

/** `export` is a module construct; the sandbox evaluates plain scripts. */
const stripExport = (text: string): string =>
  text.replace(/^\s*export\s+default\s+/, '').replace(/^\s*export\s+/, '');

/**
 * Assemble the same-file declarations `roots` transitively depends on.
 *
 * Returns undefined when no preamble is needed, and — importantly — also when a
 * correct one cannot be built: if a dependency reaches an import or an unknown
 * global, it cannot run in the sandbox, and a preamble that half-works is worse
 * than none. The prober then declines to make a claim rather than making a
 * wrong one.
 */
export const buildPreamble = (scope: FileScope, roots: ReadonlySet<string>): string | undefined => {
  const needed = new Map<string, { pos: number; text: string }>();
  const stack = [...roots];

  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || needed.has(name)) continue;

    const declaration = scope.moduleDeclarations.get(name);
    if (!declaration) continue; // A global, or something we do not need to inline.

    const refs = scanFreeIdentifiers(declaration.statement, scope);
    // This dependency itself reaches outside the file. We cannot recreate it.
    if (refs.importRefs.size > 0 || refs.unsafeGlobals.size > 0) return undefined;

    needed.set(name, {
      pos: declaration.pos,
      text: stripExport(declaration.statement.getText()),
    });
    for (const ref of refs.moduleRefs) {
      if (!needed.has(ref)) stack.push(ref);
    }
  }

  if (needed.size === 0) return undefined;

  // Source order, so declarations land in an order that evaluates.
  return [...needed.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((entry) => entry.text)
    .join('\n\n');
};
