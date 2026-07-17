import { createHash } from 'node:crypto';
import { Node, Project, ScriptTarget } from 'ts-morph';
import type { SourceFile } from 'ts-morph';

import { analyseFilePurity, buildFileScope } from './purity.js';
import { buildPreamble } from './preamble.js';
import { skipReason } from './filter.js';
import type { ExtractedFunction } from '../../Models/contracts.js';

/**
 * AST extraction — every function in the file, however it was written.
 *
 * The walk is over declarations, NOT over exports. This is load-bearing: our
 * demo target has four implementations of `truncateText` and three of them are
 * private to their file. Enumerate by export and you find one of four, the
 * cluster never forms, and the product looks like it does not work.
 */

/** `bodyHash` per the contract: sha256 of the whitespace-normalised body. */
export const hashBody = (body: string): string =>
  createHash('sha256').update(body.replace(/\s+/g, ' ').trim()).digest('hex');

export interface ExtractionResult {
  functions: ExtractedFunction[];
  /** Functions the cheap filters removed, with the reason. Never silent. */
  skipped: Array<{ name: string; file: string; line: number; reason: string }>;
}

/** Everything the file imports, for `ExtractedFunction.imports`. */
const moduleSpecifiers = (sourceFile: SourceFile): string[] => {
  const specifiers = sourceFile
    .getImportDeclarations()
    .map((declaration) => declaration.getModuleSpecifierValue());

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== 'require') return;
    const argument = node.getArguments()[0];
    if (argument && Node.isStringLiteral(argument)) specifiers.push(argument.getLiteralValue());
  });

  return [...new Set(specifiers)];
};

interface Candidate {
  key: string;
  name: string;
  node: Node;
  /** The node whose source text is the function's body text. */
  textNode: Node;
  isExported: boolean;
  isAccessor: boolean;
}

const isExportedNode = (node: Node): boolean => {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isExportable(current) && current.isExported()) return true;
    if (Node.isVariableStatement(current)) return current.isExported();
    current = current.getParent();
  }
  return false;
};

/**
 * Every named function in the file: declarations, methods, class properties,
 * object literal members, and `const f = () => ...`.
 *
 * Anonymous inline callbacks are not collected — they have no name to show and
 * are removed by the size filter anyway. Everything a human would call "a
 * function in this file" is here, regardless of whether it is exported.
 */
const collectCandidates = (sourceFile: SourceFile, file: string): Candidate[] => {
  const candidates: Candidate[] = [];
  const seen = new Set<Node>();

  const add = (name: string, node: Node, textNode: Node, isAccessor = false): void => {
    if (seen.has(textNode)) return;
    seen.add(textNode);
    candidates.push({
      key: `${file}:${name}:${textNode.getStartLineNumber()}`,
      name,
      node,
      textNode,
      isExported: isExportedNode(node),
      isAccessor,
    });
  };

  sourceFile.forEachDescendant((node) => {
    // `function foo() {}` — including nested and non-exported ones.
    if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name) add(name, node, node);
      return;
    }

    // `class X { foo() {} }`, including private and static members.
    if (Node.isMethodDeclaration(node)) {
      const name = node.getName();
      if (name) add(name, node, node);
      return;
    }

    if (Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
      const name = node.getName();
      if (name) add(name, node, node, true);
      return;
    }

    // `const foo = () => {}` / `const foo = function () {}`
    if (Node.isVariableDeclaration(node)) {
      const initialiser = node.getInitializer();
      const nameNode = node.getNameNode();
      if (
        initialiser &&
        Node.isIdentifier(nameNode) &&
        (Node.isArrowFunction(initialiser) || Node.isFunctionExpression(initialiser))
      ) {
        add(nameNode.getText(), node, initialiser);
      }
      return;
    }

    // `class X { foo = () => {} }`
    if (Node.isPropertyDeclaration(node)) {
      const initialiser = node.getInitializer();
      const name = node.getName();
      if (initialiser && name && (Node.isArrowFunction(initialiser) || Node.isFunctionExpression(initialiser))) {
        add(name, node, initialiser);
      }
      return;
    }

    // `{ foo: () => {} }` and `{ foo() {} }`
    if (Node.isPropertyAssignment(node)) {
      const initialiser = node.getInitializer();
      const name = node.getName();
      if (initialiser && name && (Node.isArrowFunction(initialiser) || Node.isFunctionExpression(initialiser))) {
        add(name, node, initialiser);
      }
      return;
    }
    if (Node.isMethodSignature(node)) return;
  });

  return candidates;
};

const parameterNames = (node: Node): string[] =>
  Node.isFunctionLikeDeclaration(node) ? node.getParameters().map((p) => p.getNameNode().getText()) : [];

/** The declaration line, without the body — enough to read, cheap in tokens. */
const signatureOf = (candidate: Candidate): string => {
  const text = candidate.textNode.getText();
  const brace = text.indexOf('{');
  const arrow = text.indexOf('=>');
  const cut = brace === -1 ? arrow : arrow === -1 ? brace : Math.min(brace, arrow);
  const head = cut === -1 ? text : text.slice(0, cut);
  return head.replace(/\s+/g, ' ').trim();
};

/** Parse one file and lift out every function it declares. */
export const extractFromSource = (file: string, contents: string): ExtractionResult => {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      target: ScriptTarget.Latest,
      allowJs: true,
      // We only ever ask syntactic questions, and a repo's real tsconfig is not
      // available in memory. Skipping lib/type resolution keeps a 500-file
      // package parsing in seconds rather than minutes.
      noLib: true,
      noResolve: true,
    },
  });

  const sourceFile = project.createSourceFile(file, contents, { overwrite: true });
  const candidates = collectCandidates(sourceFile, file);
  if (candidates.length === 0) return { functions: [], skipped: [] };

  const purity = analyseFilePurity(
    sourceFile,
    candidates.map((candidate) => ({ key: candidate.key, node: candidate.textNode }))
  );
  const scope = buildFileScope(sourceFile);
  const imports = moduleSpecifiers(sourceFile);

  const functions: ExtractedFunction[] = [];
  const skipped: ExtractionResult['skipped'] = [];

  for (const candidate of candidates) {
    const body = candidate.textNode.getText();
    const startLine = candidate.textNode.getStartLineNumber();
    const endLine = candidate.textNode.getEndLineNumber();
    const loc = endLine - startLine + 1;

    const reason = skipReason({
      name: candidate.name,
      loc,
      body,
      isAccessor: candidate.isAccessor,
    });
    if (reason) {
      skipped.push({ name: candidate.name, file, line: startLine, reason });
      continue;
    }

    const verdict = purity.get(candidate.key);
    const returnTypeNode = Node.isFunctionLikeDeclaration(candidate.textNode)
      ? candidate.textNode.getReturnTypeNode()
      : undefined;

    // Only pure functions are ever executed, so only they need a preamble.
    const preamble =
      verdict?.pure && verdict.moduleRefs.size > 0
        ? buildPreamble(scope, verdict.moduleRefs)
        : undefined;

    functions.push({
      name: candidate.name,
      file,
      startLine,
      endLine,
      signature: signatureOf(candidate),
      body,
      bodyHash: hashBody(body),
      loc,
      isExported: candidate.isExported,
      params: parameterNames(candidate.textNode),
      returnTypeText: returnTypeNode?.getText() ?? '',
      imports,
      callsExternal: verdict?.callsExternal ?? false,
      isPure: verdict?.pure ?? false,
      ...(preamble ? { preamble } : {}),
    });
  }

  return { functions, skipped };
};

/** Why a function was judged impure — for `--explain`, not for the pipeline. */
export const explainPurity = (file: string, contents: string): Map<string, string | null> => {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { target: ScriptTarget.Latest, allowJs: true, noLib: true, noResolve: true },
  });
  const sourceFile = project.createSourceFile(file, contents, { overwrite: true });
  const candidates = collectCandidates(sourceFile, file);
  const purity = analyseFilePurity(
    sourceFile,
    candidates.map((candidate) => ({ key: candidate.key, node: candidate.textNode }))
  );

  const explanations = new Map<string, string | null>();
  for (const candidate of candidates) {
    const verdict = purity.get(candidate.key);
    explanations.set(candidate.key, verdict?.pure ? null : (verdict?.reason ?? 'unknown'));
  }
  return explanations;
};
