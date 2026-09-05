import type Parser from 'tree-sitter';

/**
 * Purity check for Python functions using Tree-sitter AST nodes.
 *
 * Rules:
 * 1. Must explicitly return a value (`return x`).
 * 2. Cannot be `async def` or contain `yield` / `yield from`.
 * 3. Cannot use `global` or `nonlocal` declarations.
 * 4. Cannot call unsafe built-ins (e.g., `print`, `open`, `exec`, `eval`, `input`).
 * 5. Cannot call non-deterministic modules (e.g., `random`, `time.time()`, `datetime.now()`).
 * 6. Cannot reference imported identifiers (tracks external dependencies).
 */


const NON_DETERMINISTIC_CALLS = new Set([
  'random',
  'randint',
  'choice',
  'shuffle',
  'sample',
  'uniform',
  'time',
  'now',
  'utcnow',
  'uuid4',
  'uuid1',
]);

export interface PythonPurityVerdict {
  isPure: boolean;
  callsExternal: boolean;
  reason?: string;
}

const checkReturnsValue = (functionNode: Parser.SyntaxNode): boolean => {
  let hasReturn = false;
  const visit = (node: Parser.SyntaxNode): void => {
    if (hasReturn) return;
    // Don't inspect nested function returns
    if (node !== functionNode && (node.type === 'function_definition' || node.type === 'lambda')) {
      return;
    }
    if (node.type === 'return_statement') {
      // return statement with an expression child
      if (node.namedChildren.length > 0) {
        hasReturn = true;
        return;
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  };
  visit(functionNode);
  return hasReturn;
};

export const analysePythonPurity = (
  functionNode: Parser.SyntaxNode,
  importedNames: Set<string>
): PythonPurityVerdict => {
  let isPure = true;
  let callsExternal = false;
  let reason: string | undefined;

  const fail = (r: string): void => {
    if (isPure) {
      isPure = false;
      reason = r;
    }
  };

  // Check async
  if (functionNode.type === 'function_definition') {
    const firstChild = functionNode.children[0];
    if (firstChild?.type === 'async') {
      fail('is async function');
    }
  }

  // Check if returns a value
  if (!checkReturnsValue(functionNode)) {
    fail('returns nothing to compare');
  }

  const visit = (node: Parser.SyntaxNode): void => {
    // Nested functions are skipped from direct statement analysis
    if (node !== functionNode && (node.type === 'function_definition' || node.type === 'lambda')) {
      return;
    }

    // Generator checks
    if (node.type === 'yield' || node.type === 'yield_expression') {
      fail('yields');
    }

    // Global / Nonlocal mutation
    if (node.type === 'global_statement') {
      fail('uses global statement');
    }
    if (node.type === 'nonlocal_statement') {
      fail('uses nonlocal statement');
    }

    // Calls check
    if (node.type === 'call') {
      const functionChild = node.childForFieldName('function');
      if (functionChild) {
        if (functionChild.type === 'identifier') {
          const fnName = functionChild.text;
          if (
            fnName === 'print' ||
            fnName === 'open' ||
            fnName === 'input' ||
            fnName === 'exec' ||
            fnName === 'eval'
          ) {
            fail(`calls I/O or unsafe builtin "${fnName}"`);
          }
          if (importedNames.has(fnName)) {
            callsExternal = true;
            fail(`calls imported function "${fnName}"`);
          }
        } else if (functionChild.type === 'attribute') {
          const attr = functionChild.childForFieldName('attribute')?.text;
          const obj = functionChild.childForFieldName('object')?.text;
          if (attr && NON_DETERMINISTIC_CALLS.has(attr)) {
            fail(`calls non-deterministic method "${attr}"`);
          }
          if (obj && importedNames.has(obj)) {
            callsExternal = true;
            fail(`uses imported module "${obj}"`);
          }
        }
      }
    }

    // Identifier references
    if (node.type === 'identifier') {
      const name = node.text;
      if (importedNames.has(name)) {
        callsExternal = true;
        // If it's in a type annotation context, it does not spoil purity
        const isTypeAnnotation =
          node.parent?.type === 'type' || node.parent?.type === 'return_type';
        if (!isTypeAnnotation) {
          fail(`uses imported identifier "${name}"`);
        }
      }
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  };

  visit(functionNode);

  return { isPure, callsExternal, reason };
};
