import { describe, it, expect } from 'vitest';
import { extractPythonFromSource } from '../src/Services/indexer/language/python/adapter.js';

describe('Python Adapter - Purity Heuristics', () => {
  it('marks deterministic calculations using safe built-ins as pure', () => {
    const code = `
def sum_squares(items: list) -> int:
    total = sum([x * x for x in items])
    return total
`;
    const { functions } = extractPythonFromSource('sample.py', code);
    expect(functions[0].isPure).toBe(true);
  });

  it('marks functions with print / file I/O as impure', () => {
    const code = `
def log_and_return(x: str) -> str:
    print(x)
    return x.strip()
`;
    const { functions } = extractPythonFromSource('sample.py', code);
    expect(functions[0].isPure).toBe(false);
  });

  it('skips functions below the minimum loc threshold', () => {
    const code = `
import math

def calc_hypot(a: float, b: float) -> float:
    return math.hypot(a, b)
`;
    const { functions, skipped } = extractPythonFromSource('sample.py', code);
    expect(functions).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      name: 'calc_hypot',
      reason: 'under 3 lines',
    });
  });

  it('marks functions using imported modules as callsExternal / impure', () => {
    const code = `
import math

def calc_hypot(a: float, b: float) -> float:
    """Compute the Euclidean norm of a 2D vector."""
    return math.hypot(a, b)
`;
    const { functions } = extractPythonFromSource('sample.py', code);
    expect(functions).toHaveLength(1);
    expect(functions[0].callsExternal).toBe(true);
    expect(functions[0].isPure).toBe(false);
  });
});
