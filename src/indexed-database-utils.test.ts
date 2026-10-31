import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getResult } from './indexed-database-utils.ts';
import { readLegacyDatabase } from './legacy-database.ts';

describe('IndexedDB request failures', () => {
  it('reads an already completed request without installing event listeners', async () => {
    expect(await getResult(strictProxy<IDBRequest<number>>({ readyState: 'done', result: 42 }))).toBe(42);
  });

  it.each([new DOMException('blocked'), null])('propagates open failures and supplies an Error when IndexedDB supplies none: %j', async (error) => {
    const request = strictProxy<IDBOpenDBRequest>({ error, readyState: 'pending' });
    Object.defineProperty(request, 'addEventListener', {
      value: vi.fn((name: string, callback: () => void) => {
        if (name === 'error') {
          callback();
        }
      })
    });
    const factory = strictProxy<IDBFactory>({ open: vi.fn(() => request) });
    await expect(readLegacyDatabase({ factory, name: 'legacy', read: (): Promise<[]> => Promise.resolve([]) })).rejects.toThrow(error?.message ?? 'Unknown error');
  });
});
