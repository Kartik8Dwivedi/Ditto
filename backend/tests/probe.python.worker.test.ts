import { describe, it, expect } from 'vitest';
import { PythonProbeRunner } from '../src/Services/probe/languages/python/python.runner.js';
import type { ProbeMember } from '../src/Services/probe/contracts.js';

describe('python.worker.ts via PythonProbeRunner', { timeout: 30_000 }, () => {
  const runner = new PythonProbeRunner();

  it('executes candidate functions and reports matching outputs', async () => {
    const members: ProbeMember[] = [
      {
        id: 'fn-add',
        body: 'def add(a, b):\n    return a + b',
        isPure: true,
        language: 'python',
      },
      {
        id: 'fn-sum',
        body: 'def sum_two(x, y):\n    return y + x',
        isPure: true,
        language: 'python',
      },
    ];

    const inputs = ['[2, 3]', '[-1, 1]'];
    const result = await runner.run(members, inputs);

    expect(result.unusable).toHaveLength(0);
    expect(result.cells).toHaveLength(4);

    const cellAdd = result.cells.find((c) => c.functionId === 'fn-add' && c.input === '[2, 3]');
    const cellSum = result.cells.find((c) => c.functionId === 'fn-sum' && c.input === '[2, 3]');

    expect(cellAdd?.output).toBe('5');
    expect(cellSum?.output).toBe('5');
    expect(cellAdd?.key).toBe('return:5');
    expect(cellSum?.key).toBe('return:5');
    expect(cellAdd?.error).toBe('');
  });

  it('detects behavioral divergence between different implementations', async () => {
    const members: ProbeMember[] = [
      {
        id: 'floor-div',
        body: 'def div(a, b):\n    return a // b',
        isPure: true,
        language: 'python',
      },
      {
        id: 'float-div',
        body: 'def div(a, b):\n    return a / b',
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['[7, 2]']);

    const floorCell = result.cells.find((c) => c.functionId === 'floor-div');
    const floatCell = result.cells.find((c) => c.functionId === 'float-div');

    expect(floorCell?.output).toBe('3');
    expect(floatCell?.output).toBe('3.5');
    expect(floorCell?.key).not.toBe(floatCell?.key);
  });

  it('executes functions that depend on preambles', async () => {
    const members: ProbeMember[] = [
      {
        id: 'with-preamble',
        preamble: 'TAX_RATE = 0.2\ndef apply_tax(val):\n    return val * (1 + TAX_RATE)',
        body: 'def compute_total(price):\n    return apply_tax(price)',
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['[100]']);

    expect(result.unusable).toHaveLength(0);
    const cell = result.cells.find((c) => c.functionId === 'with-preamble');
    expect(cell?.output).toBe('120.0');
    expect(cell?.error).toBe('');
  });

  it('correctly extracts functions with inner helper functions without picking the helper', async () => {
    const members: ProbeMember[] = [
      {
        id: 'with-inner-helper',
        body: `
def main_algo(items):
    def double(x):
        return x * 2
    return [double(i) for i in items]
`,
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['[[1, 2, 3]]']);

    expect(result.unusable).toHaveLength(0);
    const cell = result.cells.find((c) => c.functionId === 'with-inner-helper');
    expect(cell?.output).toBe('[2,4,6]');
  });

  it('records Python exceptions with type and message', async () => {
    const members: ProbeMember[] = [
      {
        id: 'throws-zero-div',
        body: 'def safe_div(a, b):\n    return a / b',
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['[10, 0]']);

    const cell = result.cells[0];
    expect(cell.key).toBe('throw:ZeroDivisionError');
    expect(cell.error).toContain('ZeroDivisionError: division by zero');
    expect(cell.output).toBe('');
  });

  it('marks non-callable members as unusable without failing other members', async () => {
    const members: ProbeMember[] = [
      {
        id: 'broken-code',
        body: 'just_a_variable = 42',
        isPure: true,
        language: 'python',
      },
      {
        id: 'valid-func',
        body: 'def identity(x):\n    return x',
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['["hello"]']);

    expect(result.unusable).toHaveLength(1);
    expect(result.unusable[0].functionId).toBe('broken-code');

    expect(result.cells).toHaveLength(1);
    expect(result.cells[0].functionId).toBe('valid-func');
    expect(result.cells[0].output).toBe('"hello"');
  });

  it('interrupts infinite loops and maps them to throw:Timeout', async () => {
    const members: ProbeMember[] = [
      {
        id: 'infinite-loop',
        body: `
def loop_forever(x):
    while True:
        pass
    return x
`,
        isPure: true,
        language: 'python',
      },
    ];

    const result = await runner.run(members, ['[1]']);

    const cell = result.cells[0];
    expect(cell.key).toBe('throw:Timeout');
    expect(cell.error).toContain('Timeout: exceeded 1000ms');
  });

  it('truncates outputs that exceed maxDisplayChars and hashes the key', async () => {
    const members: ProbeMember[] = [
      {
        id: 'large-output',
        body: 'def generate_huge(n):\n    return "A" * n',
        isPure: true,
        language: 'python',
      },
    ];

    // n = 5000 chars > MAX_DISPLAY_CHARS (2000)
    const result = await runner.run(members, ['[5000]']);

    const cell = result.cells[0];
    expect(cell.output.length).toBeLessThan(2050);
    expect(cell.output.endsWith('...')).toBe(true);
    expect(cell.key.startsWith('return:')).toBe(true);
    // sha256 hex is 64 chars -> 'return:' (7 chars) + 64 chars = 71 chars
    expect(cell.key.length).toBe(71);
  });
});
