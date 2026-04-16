import { describe, it, expect } from 'vitest';
import { canonicalJson, computeHash } from '../../src/etl';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"x":1,"y":2},"b":1}');
  });

  it('leaves arrays alone (order matters)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null, booleans, strings, numbers', () => {
    expect(canonicalJson({ n: null, b: true, s: 'x', i: 42 })).toBe(
      '{"b":true,"i":42,"n":null,"s":"x"}',
    );
  });
});

describe('computeHash', () => {
  it('produces a 64-character lowercase hex digest', async () => {
    const h = await computeHash({ slug: 'pda1' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across identical inputs', async () => {
    const a = await computeHash({ x: 1, y: [2, 3] });
    const b = await computeHash({ x: 1, y: [2, 3] });
    expect(a).toBe(b);
  });

  it('is key-order independent via canonical JSON', async () => {
    const a = await computeHash({ a: 1, b: 2 });
    const b = await computeHash({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('differs when the values differ', async () => {
    const a = await computeHash({ slug: 'pda1' });
    const b = await computeHash({ slug: 'pda2' });
    expect(a).not.toBe(b);
  });
});
