/**
 * A small TypeScript tokenizer for the fixture function bodies.
 *
 * Deliberately not a real highlighter: it only has to be right for the handful
 * of short functions we render, and in exchange it costs zero dependencies (no
 * React 19 peer-dep fight) and draws from our own colour tokens so code matches
 * the rest of the UI in both themes.
 */

export type TokenKind =
  | 'keyword'
  | 'fn'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'regex'
  | 'punc'
  | 'plain';

export type Token = { text: string; kind: TokenKind };

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void',
  'null', 'undefined', 'true', 'false', 'export', 'import', 'from', 'default', 'as',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'public', 'private',
  'protected', 'readonly', 'static', 'async', 'await', 'yield', 'try', 'catch',
  'finally', 'throw', 'switch', 'case', 'this', 'super',
]);

/** Lowercase identifiers that are still types. */
const BUILTIN_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'unknown', 'any', 'never', 'object',
  'symbol', 'bigint',
]);

/** After these, a `/` opens a regex rather than dividing. */
const REGEX_ALLOWED_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case',
  'do', 'else', 'yield', 'await',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** A `/` divides only when the previous token could end an expression. */
function regexCanStart(prev: Token | undefined): boolean {
  if (!prev) return true;
  if (prev.kind === 'keyword') return REGEX_ALLOWED_AFTER_WORD.has(prev.text);
  if (prev.kind === 'number' || prev.kind === 'string' || prev.kind === 'regex') return false;
  if (prev.kind === 'plain' || prev.kind === 'fn' || prev.kind === 'type') return false;
  if (prev.kind === 'punc') return !')]}'.includes(prev.text);
  return true;
}

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let significant: Token | undefined;

  const push = (text: string, kind: TokenKind) => {
    tokens.push({ text, kind });
    if (kind !== 'comment' && text.trim() !== '') significant = { text, kind };
  };

  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // whitespace
    if (/\s/.test(ch)) {
      let j = i;
      while (j < code.length && /\s/.test(code[j])) j++;
      tokens.push({ text: code.slice(i, j), kind: 'plain' });
      i = j;
      continue;
    }

    // comments
    if (ch === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      push(code.slice(i, stop), 'comment');
      i = stop;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      push(code.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    // strings (single, double, template)
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      push(code.slice(i, j), 'string');
      i = j;
      continue;
    }

    // regex literal
    if (ch === '/' && regexCanStart(significant)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < code.length) {
        const c = code[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        while (j < code.length && /[gimsuyd]/.test(code[j])) j++;
        push(code.slice(i, j), 'regex');
        i = j;
        continue;
      }
    }

    // numbers
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < code.length && /[0-9._xXa-fA-F]/.test(code[j])) j++;
      push(code.slice(i, j), 'number');
      i = j;
      continue;
    }

    // identifiers
    if (IDENT_START.test(ch)) {
      let j = i;
      while (j < code.length && IDENT_PART.test(code[j])) j++;
      const word = code.slice(i, j);

      let k = j;
      while (k < code.length && /\s/.test(code[k])) k++;
      const next = code[k];
      const prevChar = tokens.length > 0 ? code[i - 1] : '';

      let kind: TokenKind;
      if (KEYWORDS.has(word)) {
        kind = 'keyword';
      } else if (next === '(') {
        kind = 'fn';
      } else if (BUILTIN_TYPES.has(word)) {
        kind = 'type';
      } else if (/^[A-Z]/.test(word) && next !== '.' && prevChar !== '.') {
        kind = 'type';
      } else {
        kind = 'plain';
      }
      push(word, kind);
      i = j;
      continue;
    }

    // everything else is punctuation
    push(ch, 'punc');
    i += 1;
  }

  return tokens;
}

/**
 * Tokenize the whole source, then break the stream into lines.
 *
 * Tokenizing line-by-line would be wrong: whether a `/` opens a regex or
 * divides depends on the token before it, which may sit on a previous line.
 */
export function tokenizeLines(code: string): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code)) {
    const parts = token.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== '') lines[lines.length - 1].push({ text: part, kind: token.kind });
    });
  }
  return lines;
}

export const TOKEN_COLOR: Record<TokenKind, string> = {
  keyword: 'var(--code-keyword)',
  fn: 'var(--code-fn)',
  string: 'var(--code-string)',
  number: 'var(--code-number)',
  comment: 'var(--code-comment)',
  type: 'var(--code-type)',
  regex: 'var(--code-regex)',
  punc: 'var(--code-punc)',
  plain: 'inherit',
};
