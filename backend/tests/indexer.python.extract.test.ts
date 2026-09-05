import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPythonSourceFile } from './../src/Services/indexer/language/python/filter.js';
import { extractPythonFromSource } from './../src/Services/indexer/language/python/adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Python Adapter - isPythonSourceFile', () => {
  it('accepts valid python source files', () => {
    expect(isPythonSourceFile('app/main.py')).toBe(true);
    expect(isPythonSourceFile('utils/helpers.pyi')).toBe(true);
  });

  it('rejects virtual environments, caches, and test files', () => {
    expect(isPythonSourceFile('.venv/lib/python3.11/site-packages/pkg.py')).toBe(false);
    expect(isPythonSourceFile('venv/main.py')).toBe(false);
    expect(isPythonSourceFile('__pycache__/app.cpython-311.py')).toBe(false);
    expect(isPythonSourceFile('tests/test_main.py')).toBe(false);
    expect(isPythonSourceFile('app/conftest.py')).toBe(false);
  });
});

describe('Python Adapter - extractPythonFromSource', () => {
  it('extracts top-level functions, class methods, parameters, and return types', () => {
    const code = `
def normalize_phone(phone: str) -> str:
    digits = [c for c in phone if c.isdigit()]
    return "".join(digits)

class Formatter:
    def format_text(self, text: str, max_len: int = 100) -> str:
        if len(text) <= max_len:
            return text
        return text[:max_len] + "..."
`;

    const { functions } = extractPythonFromSource('sample.py', code);
    expect(functions).toHaveLength(2);

    const [fn1, fn2] = functions;
    expect(fn1.name).toBe('normalize_phone');
    expect(fn1.params).toEqual(['phone']);
    expect(fn1.returnTypeText).toBe('str');
    expect(fn1.isExported).toBe(true);
    expect(fn1.startLine).toBe(2);

    expect(fn2.name).toBe('format_text');
    expect(fn2.params).toEqual(['text', 'max_len']); // Stripped 'self'
    expect(fn2.returnTypeText).toBe('str');
  });

  it('extracts private functions with isExported = false', () => {
    const code = `
def _private_func(x: int) -> int:
    y = x + 1
    return y * 2
`;
    const { functions } = extractPythonFromSource('sample.py', code);
    expect(functions[0].isExported).toBe(false);
  });

  it('extracts every function from the sample fixture', () => {
    const path = resolve(__dirname, 'fixtures/python/sample.py');
    const code = readFileSync(path, 'utf8');
    const { functions, skipped } = extractPythonFromSource('sample.py', code);

    expect(functions.map((f) => f.name).sort()).toEqual([
      '_private_helper',
      'calc_hypot',
      'format_text',
      'impure_io',
      'log_and_return',
      'normalize_phone',
      'sum_squares',
    ]);
    expect(skipped.map((s) => s.name).sort()).toEqual(['impure_time']);

    const privateHelper = functions.find((f) => f.name === '_private_helper');
    expect(privateHelper?.isExported).toBe(false);

    const formatText = functions.find((f) => f.name === 'format_text');
    expect(formatText?.params).toEqual(['text', 'max_len']);
    expect(formatText?.isPure).toBe(true);

    const calcHypot = functions.find((f) => f.name === 'calc_hypot');
    expect(calcHypot?.callsExternal).toBe(true);
    expect(calcHypot?.isPure).toBe(false);

    const impureIo = functions.find((f) => f.name === 'impure_io');
    expect(impureIo?.isPure).toBe(false);

    const logAndReturn = functions.find((f) => f.name === 'log_and_return');
    expect(logAndReturn?.isPure).toBe(false);

    const sumSquares = functions.find((f) => f.name === 'sum_squares');
    expect(sumSquares?.isPure).toBe(true);

    const normalizePhone = functions.find((f) => f.name === 'normalize_phone');
    expect(normalizePhone?.isExported).toBe(true);
  });
});
