import { Node, SyntaxKind, ts } from 'ts-morph';
import type { SourceFile } from 'ts-morph';

/**
 * PURITY — the gate on execution.
 *
 * This decides whether the prober is allowed to run a function, so it is the
 * difference between "the divergence table is executed ground truth" and "we ran
 * something that talked to a database". It is also the difference between a hero
 * cluster surfacing and being silently dropped, which is why the rule is precise
 * rather than merely cautious:
 *
 *   NOT pure — mutates anything outside itself, touches I/O (network, files,
 *   console, timers), reads a non-deterministic source (Date.now, Math.random),
 *   uses an imported identifier, or uses `this` / `await`.
 *
 *   STILL pure — reads module-level state, however mutable that state is, and
 *   calls same-file helpers that are themselves pure.
 *
 * The asymmetry is the whole point. `actualbudget/actual`'s `currencyToAmount`
 * calls a same-file helper that READS module-level config. It is deterministic
 * in practice, and a filter that barred reads rather than mutation would drop it
 * and take the cluster with it. Bar mutation and I/O. Allow reads.
 */

/**
 * Globals a pure function may use. An allowlist, not a blocklist: a blocklist
 * silently admits every host global we forgot to think of, and "we forgot" is
 * how a probe ends up making a network call.
 */
const SAFE_GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Math', 'JSON', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'Intl',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'Infinity', 'NaN', 'undefined', 'globalThis',
  'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
  'structuredClone', 'escape', 'unescape',
]);

/** Deterministic-looking calls that are not: `Math.random()`, `Date.now()`. */
const NON_DETERMINISTIC_MEMBERS: Record<string, Set<string>> = {
  Math: new Set(['random']),
  Date: new Set(['now']),
};

/** Methods that mutate their receiver in place. */
const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'add', 'delete', 'clear',
  'setDate', 'setMonth', 'setFullYear', 'setHours', 'setMinutes', 'setSeconds',
  'setMilliseconds', 'setTime', 'setUTCDate', 'setUTCFullYear', 'setUTCHours',
]);

/**
 * Expressions that produce a NEW value, so mutating the result mutates nothing
 * anyone else can see. `const out = input.slice(); out.sort()` is pure.
 */
const COPYING_METHODS = new Set([
  'slice', 'map', 'filter', 'concat', 'flat', 'flatMap', 'split', 'toSorted',
  'toReversed', 'toSpliced', 'with', 'from', 'of', 'keys', 'values', 'entries',
  'assign', 'parse', 'fromEntries', 'getOwnPropertyNames',
]);

const ASSIGNMENT_OPERATORS = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

/** A module-level declaration, and the statement text that would recreate it. */
export interface ModuleDeclaration {
  name: string;
  /** The whole statement — `const x = 1;`, not just `x = 1`. */
  statement: Node;
  /** Source order, so a preamble can be emitted in a runnable sequence. */
  pos: number;
  isFunction: boolean;
}

export interface FileScope {
  /** Value bindings the file imports. Type-only imports are erased, so ignored. */
  importedValues: Set<string>;
  /** Module-level binding names — reading these is allowed. */
  moduleBindings: Set<string>;
  /** Module-level bindings that are functions, by name. Purity propagates through these. */
  moduleFunctions: Map<string, Node>;
  /** Every module-level declaration, for assembling execution preambles. */
  moduleDeclarations: Map<string, ModuleDeclaration>;
}

export interface LocalPurity {
  pure: boolean;
  reason?: string;
  /** Same-file functions this body calls — resolved to verdicts by the fixpoint. */
  sameFileCalls: Set<string>;
  /** EVERY module-level binding the body reads, functions or not. */
  moduleRefs: Set<string>;
  /** The body references an identifier the file imported. */
  callsExternal: boolean;
}

/** What a node reaches for that it does not declare itself. */
export interface FreeIdentifiers {
  moduleRefs: Set<string>;
  importRefs: Set<string>;
  unsafeGlobals: Set<string>;
}

/**
 * Free identifiers of any node, classified against the file's scope.
 *
 * Used to walk a preamble's own dependencies: a helper we inline may itself read
 * another module-level constant, and that one has to come along too.
 */
export const scanFreeIdentifiers = (node: Node, scope: FileScope): FreeIdentifiers => {
  const moduleRefs = new Set<string>();
  const importRefs = new Set<string>();
  const unsafeGlobals = new Set<string>();
  const { all: locals } = collectLocalBindings(node);

  node.forEachDescendant((child) => {
    if (!Node.isIdentifier(child)) return;
    if (!isValueReference(child)) return;
    const name = child.getText();
    if (locals.has(name)) return;
    if (scope.importedValues.has(name)) importRefs.add(name);
    else if (scope.moduleBindings.has(name)) moduleRefs.add(name);
    else if (!SAFE_GLOBALS.has(name)) unsafeGlobals.add(name);
  });

  return { moduleRefs, importRefs, unsafeGlobals };
};

/**
 * Type annotations are erased at runtime, so an imported TYPE says nothing about
 * purity. Missing this would mark most annotated TypeScript impure and quietly
 * empty the index.
 */
const isInTypePosition = (node: Node): boolean => {
  let current: ts.Node | undefined = node.compilerNode.parent;
  while (current) {
    if (
      ts.isTypeNode(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeParameterDeclaration(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

/** Identifiers that name something rather than referring to a value. */
const isValueReference = (node: Node): boolean => {
  const parent = node.getParent();
  if (!parent) return false;

  // `obj.name` — `name` is a property, not a binding in scope.
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return false;
  // `{ name: value }` — the key.
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === node) return false;
  // `{ name }` in a pattern is a binding; `{ name }` in a literal IS a read, so
  // shorthand assignments are deliberately not excluded here.
  if (Node.isBindingElement(parent) && parent.getPropertyNameNode() === node) return false;
  if (Node.isImportSpecifier(parent) || Node.isExportSpecifier(parent)) return false;
  if (Node.isImportClause(parent) || Node.isNamespaceImport(parent)) return false;
  if (Node.isMethodDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isPropertyDeclaration(parent) && parent.getNameNode() === node) return false;
  if (Node.isQualifiedName(parent)) return false;
  if (Node.isLabeledStatement(parent)) return false;

  // Any declaration's own name is not a reference to something else.
  if (
    (Node.isVariableDeclaration(parent) ||
      Node.isFunctionDeclaration(parent) ||
      Node.isClassDeclaration(parent) ||
      Node.isParameterDeclaration(parent)) &&
    parent.getNameNode() === node
  ) {
    return false;
  }

  return !isInTypePosition(node);
};

/** Every name bound anywhere inside this function, including nested scopes. */
const collectLocalBindings = (fn: Node): { all: Set<string>; parameters: Set<string> } => {
  const all = new Set<string>();
  const parameters = new Set<string>();

  const addNames = (nameNode: Node | undefined, into: Set<string>): void => {
    if (!nameNode) return;
    if (Node.isIdentifier(nameNode)) {
      into.add(nameNode.getText());
      return;
    }
    // Destructuring: `{ a, b: c }` / `[x, ...rest]`.
    nameNode.forEachDescendant((descendant) => {
      if (Node.isBindingElement(descendant)) {
        const name = descendant.getNameNode();
        if (Node.isIdentifier(name)) into.add(name.getText());
      }
    });
  };

  if (Node.isFunctionLikeDeclaration(fn)) {
    for (const parameter of fn.getParameters()) {
      addNames(parameter.getNameNode(), parameters);
      addNames(parameter.getNameNode(), all);
    }
  }

  fn.forEachDescendant((node) => {
    if (Node.isVariableDeclaration(node)) addNames(node.getNameNode(), all);
    else if (Node.isParameterDeclaration(node)) addNames(node.getNameNode(), all);
    else if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) {
      const name = node.getNameNode();
      if (name) all.add(name.getText());
    } else if (Node.isCatchClause(node)) {
      addNames(node.getVariableDeclaration()?.getNameNode(), all);
    }
  });

  return { all, parameters };
};

/** The identifier a member expression is ultimately rooted at: `a.b[c].d` -> `a`. */
const rootIdentifier = (node: Node): Node | undefined => {
  let current: Node = node;
  for (;;) {
    if (Node.isIdentifier(current)) return current;
    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return undefined;
  }
};

/** True when `name`'s declaration inside `fn` initialises it to a fresh value. */
const isFreshLocal = (fn: Node, name: string): boolean => {
  let fresh = false;
  fn.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;
    const nameNode = node.getNameNode();
    if (!Node.isIdentifier(nameNode) || nameNode.getText() !== name) return;

    const initialiser = node.getInitializer();
    if (!initialiser) return;
    if (
      Node.isObjectLiteralExpression(initialiser) ||
      Node.isArrayLiteralExpression(initialiser) ||
      Node.isNewExpression(initialiser) ||
      Node.isStringLiteral(initialiser) ||
      Node.isTemplateExpression(initialiser)
    ) {
      fresh = true;
      return;
    }
    // `input.slice()`, `Object.assign({}, x)`, `Array.from(y)` — all make a copy.
    if (Node.isCallExpression(initialiser)) {
      const callee = initialiser.getExpression();
      if (Node.isPropertyAccessExpression(callee) && COPYING_METHODS.has(callee.getName())) {
        fresh = true;
      }
    }
  });
  return fresh;
};

/**
 * Purity of one function, ignoring what its same-file callees do — that is
 * resolved afterwards by {@link analyseFilePurity}'s fixpoint.
 */
export const analyseLocalPurity = (fn: Node, scope: FileScope): LocalPurity => {
  const sameFileCalls = new Set<string>();
  const moduleRefs = new Set<string>();
  let callsExternal = false;
  let impureReason: string | null = null;

  const fail = (reason: string): void => {
    impureReason ??= reason;
  };

  // `async`/generator markers live on the specific function-like nodes, not on
  // the shared FunctionLikeDeclaration union — narrow before asking.
  if (
    (Node.isFunctionDeclaration(fn) ||
      Node.isFunctionExpression(fn) ||
      Node.isArrowFunction(fn) ||
      Node.isMethodDeclaration(fn)) &&
    fn.isAsync()
  ) {
    fail('is async');
  }
  if (
    (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isFunctionExpression(fn)) &&
    fn.isGenerator()
  ) {
    fail('is a generator');
  }

  const { all: locals, parameters } = collectLocalBindings(fn);

  /** Writing through a binding that is not ours to write. */
  const checkMutation = (target: Node, kind: string): void => {
    const root = rootIdentifier(target);
    if (!root) {
      fail(`${kind} through an expression we cannot resolve`);
      return;
    }

    const name = root.getText();
    const isPropertyWrite = root !== target;

    if (!locals.has(name)) {
      // Module-level, imported, or global — all outside this function.
      fail(`${kind} of "${name}", which is declared outside the function`);
      return;
    }
    if (!isPropertyWrite) return; // Rebinding a local is nobody else's business.

    if (parameters.has(name)) {
      // The object belongs to the caller; changing it is a side effect.
      fail(`${kind} of a property of parameter "${name}"`);
      return;
    }
    if (!isFreshLocal(fn, name)) {
      // A local that ALIASES something else — mutating it reaches outside.
      fail(`${kind} through local "${name}", which may alias state outside the function`);
    }
  };

  // No early exit once a reason is found: `callsExternal` is a fact about the
  // body in its own right (it feeds the compatibility filter), not a by-product
  // of the purity verdict, so the whole body is always walked.
  fn.forEachDescendant((node) => {
    if (Node.isThisExpression(node)) {
      fail('uses `this`');
      return;
    }
    if (Node.isAwaitExpression(node)) {
      fail('uses `await`');
      return;
    }
    if (node.getKind() === SyntaxKind.YieldExpression) {
      fail('yields');
      return;
    }

    if (Node.isBinaryExpression(node)) {
      if (ASSIGNMENT_OPERATORS.has(node.getOperatorToken().getKind())) {
        checkMutation(node.getLeft(), 'assignment');
      }
      return;
    }
    if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
      const operator = node.getOperatorToken();
      if (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) {
        checkMutation(node.getOperand(), 'increment');
      }
      return;
    }
    if (Node.isDeleteExpression(node)) {
      checkMutation(node.getExpression(), 'delete');
      return;
    }

    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        const method = callee.getName();
        const receiver = callee.getExpression();

        // `Math.random()` / `Date.now()` — deterministic-looking, aren't.
        if (Node.isIdentifier(receiver) && !locals.has(receiver.getText())) {
          const banned = NON_DETERMINISTIC_MEMBERS[receiver.getText()];
          if (banned?.has(method)) fail(`calls ${receiver.getText()}.${method}()`);
        }
        if (MUTATING_METHODS.has(method)) checkMutation(receiver, `${method}()`);
      }
      // A bare `Date()` reads the clock, exactly like `new Date()`.
      if (Node.isIdentifier(callee) && callee.getText() === 'Date' && node.getArguments().length === 0) {
        fail('calls `Date()` with no argument, which reads the clock');
      }
      return;
    }

    if (Node.isNewExpression(node)) {
      const callee = node.getExpression();
      if (Node.isIdentifier(callee) && callee.getText() === 'Date' && node.getArguments().length === 0) {
        fail('constructs `new Date()` with no argument, which reads the clock');
      }
      return;
    }

    if (!Node.isIdentifier(node)) return;
    if (!isValueReference(node)) return;

    const name = node.getText();
    if (locals.has(name)) return;

    if (scope.importedValues.has(name)) {
      callsExternal = true;
      fail(`uses imported identifier "${name}"`);
      return;
    }

    if (scope.moduleBindings.has(name)) {
      // A module-level READ. Allowed — deliberately, see the file header.
      moduleRefs.add(name);
      if (scope.moduleFunctions.has(name)) sameFileCalls.add(name);
      return;
    }

    if (!SAFE_GLOBALS.has(name)) {
      fail(`uses "${name}", which is not a known-safe global`);
    }
  });

  if (!returnsAValue(fn)) fail('returns nothing to compare');

  return {
    pure: impureReason === null,
    ...(impureReason ? { reason: impureReason } : {}),
    sameFileCalls,
    moduleRefs,
    callsExternal,
  };
};

/**
 * Does this function produce a value? A function that returns nothing has no
 * output for the prober to compare, so it cannot take part in a divergence.
 */
export const returnsAValue = (fn: Node): boolean => {
  if (Node.isArrowFunction(fn) && !Node.isBlock(fn.getBody())) return true;

  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    for (const child of node.getChildren()) {
      if (found) return;
      // A `return` inside a nested function belongs to that function.
      if (Node.isFunctionDeclaration(child) || Node.isFunctionExpression(child) || Node.isArrowFunction(child)) {
        continue;
      }
      if (Node.isReturnStatement(child) && child.getExpression()) {
        found = true;
        return;
      }
      visit(child);
    }
  };
  visit(fn);
  return found;
};

/** The imports and module-level bindings a file's functions resolve against. */
export const buildFileScope = (sourceFile: SourceFile): FileScope => {
  const importedValues = new Set<string>();
  const moduleBindings = new Set<string>();
  const moduleFunctions = new Map<string, Node>();
  const moduleDeclarations = new Map<string, ModuleDeclaration>();

  const declare = (name: string, statement: Node, isFunction: boolean): void => {
    moduleBindings.add(name);
    moduleDeclarations.set(name, { name, statement, pos: statement.getPos(), isFunction });
  };

  for (const declaration of sourceFile.getImportDeclarations()) {
    // `import type { X }` is erased before anything runs.
    if (declaration.isTypeOnly()) continue;

    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) importedValues.add(defaultImport.getText());

    const namespaceImport = declaration.getNamespaceImport();
    if (namespaceImport) importedValues.add(namespaceImport.getText());

    for (const specifier of declaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      importedValues.add((specifier.getAliasNode() ?? specifier.getNameNode()).getText());
    }
  }

  // `require(...)` bindings count as imports too.
  for (const statement of sourceFile.getVariableStatements()) {
    for (const declaration of statement.getDeclarations()) {
      const initialiser = declaration.getInitializer();
      const isRequire =
        initialiser &&
        Node.isCallExpression(initialiser) &&
        Node.isIdentifier(initialiser.getExpression()) &&
        initialiser.getExpression().getText() === 'require';

      const nameNode = declaration.getNameNode();
      const names: string[] = [];
      if (Node.isIdentifier(nameNode)) names.push(nameNode.getText());
      else {
        nameNode.forEachDescendant((d) => {
          if (Node.isBindingElement(d)) {
            const n = d.getNameNode();
            if (Node.isIdentifier(n)) names.push(n.getText());
          }
        });
      }

      const isFunction =
        !!initialiser && (Node.isArrowFunction(initialiser) || Node.isFunctionExpression(initialiser));

      for (const name of names) {
        // The whole statement, so a preamble emits `const x = ...;` not `x = ...`.
        if (isRequire) importedValues.add(name);
        else declare(name, statement, isFunction);
      }

      if (!isRequire && isFunction && Node.isIdentifier(nameNode) && initialiser) {
        moduleFunctions.set(nameNode.getText(), initialiser);
      }
    }
  }

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    declare(name, fn, true);
    moduleFunctions.set(name, fn);
  }
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (name) declare(name, cls, false);
  }
  for (const enumeration of sourceFile.getEnums()) {
    declare(enumeration.getName(), enumeration, false);
  }

  return { importedValues, moduleBindings, moduleFunctions, moduleDeclarations };
};

/**
 * Purity for every function in a file, with same-file calls resolved.
 *
 * A function that is locally pure but calls an impure same-file helper is impure
 * — that is what "calls a same-file PURE helper" means, and skipping the check
 * would let a helper that writes a file make its caller look safe to execute.
 * Iterated to a fixpoint so a chain of helpers propagates all the way up.
 */
export const analyseFilePurity = (
  sourceFile: SourceFile,
  functions: Array<{ key: string; node: Node }>
): Map<string, LocalPurity> => {
  const scope = buildFileScope(sourceFile);
  const local = new Map<string, LocalPurity>();
  for (const { key, node } of functions) local.set(key, analyseLocalPurity(node, scope));

  // Name -> keys, so a call to `helper` finds the verdict(s) for that function.
  const keysByName = new Map<string, string[]>();
  for (const { key, node } of functions) {
    const name = Node.isFunctionDeclaration(node) ? node.getName() : undefined;
    const resolved = name ?? keyName(key);
    const existing = keysByName.get(resolved);
    if (existing) existing.push(key);
    else keysByName.set(resolved, [key]);
  }

  for (let pass = 0; pass < functions.length + 1; pass += 1) {
    let changed = false;
    for (const [key, verdict] of local) {
      if (!verdict.pure) continue;
      for (const callee of verdict.sameFileCalls) {
        const calleeKeys = keysByName.get(callee) ?? [];
        const impureCallee = calleeKeys.find((calleeKey) => local.get(calleeKey)?.pure === false);
        if (impureCallee) {
          local.set(key, {
            ...verdict,
            pure: false,
            reason: `calls same-file "${callee}", which is impure (${local.get(impureCallee)?.reason})`,
          });
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  return local;
};

/** Keys look like `file:name:line`; the name is the middle part. */
const keyName = (key: string): string => key.split(':')[1] ?? key;
