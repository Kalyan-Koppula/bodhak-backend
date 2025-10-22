import { describe, test, expect } from 'vitest';
import { LexoRank } from '@dalet-oss/lexorank';
import { calculateNewRank } from '../../src/index';

describe('calculateNewRank', () => {
  test('between two ranks', () => {
    const a = LexoRank.middle().toString();
    const b = LexoRank.middle().genNext().toString();
    const r = calculateNewRank(a, b);
    expect(r).toBeDefined();
    expect(typeof r?.toString()).toBe('string');
  });

  test('genPrev when only beforeRank provided', () => {
    const a = LexoRank.middle().toString();
    const r = calculateNewRank(a, undefined);
    expect(r).toBeDefined();
  });

  test('genNext when only afterRank provided', () => {
    const b = LexoRank.middle().toString();
    const r = calculateNewRank(undefined, b);
    expect(r).toBeDefined();
  });

  test('returns undefined when neither provided', () => {
    const r = calculateNewRank(undefined, undefined);
    expect(r).toBeUndefined();
  });
});
