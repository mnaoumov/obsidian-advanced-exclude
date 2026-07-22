import {
  describe,
  expect,
  it
} from 'vitest';

import { computeUniverseSignature } from './universe-signature.ts';

describe('computeUniverseSignature', () => {
  it('is independent of iteration order', () => {
    const a = computeUniverseSignature(['a.md', 'b/c.md', 'd']);
    const b = computeUniverseSignature(['d', 'a.md', 'b/c.md']);
    expect(a).toBe(b);
  });

  it('collapses duplicates so hidden ∪ loaded matches whether or not they overlap', () => {
    // Persist time: hidden and loaded are disjoint. Warm enable: loaded already
    // Includes the restored hidden files. Both must yield the same signature.
    const persistTime = computeUniverseSignature(['a.md', 'junk.tmp']); // loaded=[a.md] + hidden=[junk.tmp]
    const warmEnable = computeUniverseSignature(['a.md', 'junk.tmp', 'junk.tmp']); // loaded=[a.md, junk.tmp] + hidden=[junk.tmp]
    expect(warmEnable).toBe(persistTime);
  });

  it('changes when a path is added', () => {
    const before = computeUniverseSignature(['a.md', 'b.md']);
    const after = computeUniverseSignature(['a.md', 'b.md', 'c.md']);
    expect(after).not.toBe(before);
  });

  it('changes when a path is removed', () => {
    const before = computeUniverseSignature(['a.md', 'b.md', 'c.md']);
    const after = computeUniverseSignature(['a.md', 'b.md']);
    expect(after).not.toBe(before);
  });

  it('changes when a path is swapped for another (same count)', () => {
    const before = computeUniverseSignature(['a.md', 'b.md']);
    const after = computeUniverseSignature(['a.md', 'c.md']);
    expect(after).not.toBe(before);
  });

  it('gives an empty universe a stable signature', () => {
    expect(computeUniverseSignature([])).toBe(computeUniverseSignature([]));
  });
});
