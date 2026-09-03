import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { isPythonSourceFile } from './filter.js';
import { analysePythonPurity } from './purity.js';
import type { ExtractedFunction } from '../../../../Models/contracts.js';
import { hashBody, type ExtractionResult } from '../../extract.js';
import { skipReason } from '../../filter.js';
import type { LanguageAdapter } from '../adapter.js';


const parser = new Parser();
parser.setLanguage(Python);

/** Extract top-level imports and from-imports from Python AST */
const extractImports = (rootNode: Parser.SyntaxNode): { imports: string[]; importedNames: Set<string> } => {
  const imports: string[] = [];
  const importedNames = new Set<string>();

  for (const node of rootNode.namedChildren) {
    if (node.type === 'import_statement') {
      // e.g. import math, os as operating_system
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const nameNode = child.childForFieldName('name') ?? child;
          imports.push(nameNode.text);
          const aliasNode = child.childForFieldName('alias');
          importedNames.add(aliasNode ? aliasNode.text : nameNode.text);
        }
      }
    } else if (node.type === 'import_from_statement') {
      // e.g. from math import sqrt, sin as s
      const moduleNode = node.childForFieldName('module_name');
      if (moduleNode) {
        imports.push(moduleNode.text);
      }
      for (const child of node.namedChildren) {
        if (child.type === 'aliased_import') {
          const alias = child.childForFieldName('alias')?.text;
          const name = child.childForFieldName('name')?.text;
          if (alias) importedNames.add(alias);
          else if (name) importedNames.add(name);
        } else if (child.type === 'dotted_name' && child !== moduleNode) {
          importedNames.add(child.text);
        } else if (child.type === 'identifier') {
          importedNames.add(child.text);
        }
      }
    }
  }

  return { imports: [...new Set(imports)], importedNames };
};

/** Extract parameter names, stripping 'self' and 'cls' for canonical clustering */
const extractParameters = (parametersNode: Parser.SyntaxNode | null): string[] => {
  if (!parametersNode) return [];
  const params: string[] = [];

  for (const child of parametersNode.namedChildren) {
    let name: string | undefined;
    if (child.type === 'identifier') {
      name = child.text;
    } else if (child.type === 'typed_parameter' || child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
      const nameNode = child.childForFieldName('name') ?? child.namedChildren[0];
      if (nameNode) name = nameNode.text;
    }

    if (name && name !== 'self' && name !== 'cls') {
      params.push(name);
    }
  }

  return params;
};

/** Extract return type annotation text */
const extractReturnType = (fnNode: Parser.SyntaxNode): string => {
  const returnTypeNode = fnNode.childForFieldName('return_type');
  if (!returnTypeNode) return '';
  return returnTypeNode.text.replace(/^->\s*/, '').trim();
};

/** Build single-line signature text */
const extractSignature = (fnNode: Parser.SyntaxNode, source: string): string => {
  const bodyNode = fnNode.childForFieldName('body');
  const colonIndex = bodyNode ? bodyNode.startIndex : fnNode.endIndex;
  const sigText = source.slice(fnNode.startIndex, colonIndex).replace(/:\s*$/, '');
  return sigText.replace(/\s+/g, ' ').trim();
};

export const extractPythonFromSource = (file: string, contents: string): ExtractionResult => {
  const tree = parser.parse(contents);
  const rootNode = tree.rootNode;
  const { imports, importedNames } = extractImports(rootNode);

  const functions: ExtractedFunction[] = [];
  const skipped: ExtractionResult['skipped'] = [];

  const visit = (node: Parser.SyntaxNode): void => {
    let fnNode: Parser.SyntaxNode | null = null;

    if (node.type === 'function_definition') {
      fnNode = node;
    } else if (node.type === 'decorated_definition') {
      const definition = node.childForFieldName('definition');
      if (definition && definition.type === 'function_definition') {
        fnNode = definition;
      }
    }

    if (fnNode) {
      const nameNode = fnNode.childForFieldName('name');
      const name = nameNode ? nameNode.text : '<anonymous>';

      // Tree-Sitter is 0-indexed; Ditto contract is 1-indexed
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const loc = endLine - startLine + 1;

      // Extract raw body
      const body = contents.slice(node.startIndex, node.endIndex);

      // Check skip reasons
      const reason = skipReason({
        name,
        loc,
        body,
        isAccessor: false,
      });

      if (reason) {
        skipped.push({ name, file, line: startLine, reason });
      } else {
        const params = extractParameters(fnNode.childForFieldName('parameters'));
        const returnTypeText = extractReturnType(fnNode);
        const signature = extractSignature(fnNode, contents);
        const isExported = !name.startsWith('_');

        const purity = analysePythonPurity(fnNode, importedNames);

        functions.push({
          name,
          file,
          startLine,
          endLine,
          signature,
          body,
          bodyHash: hashBody(body),
          loc,
          isExported,
          params,
          returnTypeText,
          imports,
          callsExternal: purity.callsExternal,
          isPure: purity.isPure,
        });
      }
    }

    for (const child of node.namedChildren) {
      // Don't recurse inside function bodies to find nested functions (matches TS behavior)
      if (node.type !== 'function_definition') {
        visit(child);
      }
    }
  };

  visit(rootNode);

  return { functions, skipped };
};

export const pythonAdapter: LanguageAdapter = {
  isSourceFile: isPythonSourceFile,
  extract: extractPythonFromSource,
};

export default pythonAdapter;