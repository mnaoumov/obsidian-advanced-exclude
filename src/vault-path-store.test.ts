import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { VaultModelEntry } from './vault-model.ts';

import { IndexedDbVaultPathStore } from './vault-path-store.ts';

interface MockPathsStore {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

interface SetupResult {
  readonly openFn: ReturnType<typeof vi.fn>;
  readonly pathsStore: MockPathsStore;
  readonly store: IndexedDbVaultPathStore;
}

function createDoneRequest<T>(result: T): IDBRequest<T> {
  const request = { readyState: 'done' as IDBRequestReadyState, result };
  Object.defineProperty(request, 'addEventListener', { value: vi.fn() });
  return request as IDBRequest<T>;
}

function setupDb(getValue: undefined | VaultModelEntry[]): SetupResult {
  const pathsStore: MockPathsStore = {
    get: vi.fn().mockReturnValue(createDoneRequest(getValue)),
    put: vi.fn()
  };

  const mockDb = strictProxy<IDBDatabase>({ createObjectStore: vi.fn() });
  Object.defineProperty(mockDb, 'transaction', {
    value: vi.fn(() => ({ commit: vi.fn(), objectStore: vi.fn(() => pathsStore) }))
  });

  // A pending open request that resolves via its `success` event (covers the async path).
  const openRequest = strictProxy<IDBOpenDBRequest>({ readyState: 'pending', result: mockDb });
  Object.defineProperty(openRequest, 'addEventListener', {
    value: vi.fn((event: string, handler: () => void) => {
      if (event === 'upgradeneeded' || event === 'success') {
        handler();
      }
    })
  });

  const openFn = vi.fn().mockReturnValue(openRequest);
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: strictProxy<IDBFactory>({ open: openFn }),
    writable: true
  });

  return { openFn, pathsStore, store: new IndexedDbVaultPathStore('app-id') };
}

describe('IndexedDbVaultPathStore', () => {
  it('loads persisted entries', async () => {
    const entries: VaultModelEntry[] = [{ isFolder: false, path: 'a.md' }];
    const { store } = setupDb(entries);
    expect(await store.load()).toEqual(entries);
  });

  it('returns an empty array when nothing is persisted', async () => {
    const { store } = setupDb(undefined);
    expect(await store.load()).toEqual([]);
  });

  it('saves entries to the store after the database is open', async () => {
    const { pathsStore, store } = setupDb(undefined);
    await store.load();

    const entries: VaultModelEntry[] = [{ isFolder: true, path: 'folder' }];
    store.save(entries);

    expect(pathsStore.put).toHaveBeenCalledWith(entries, 'paths');
  });

  it('does not save when the database is not open', () => {
    const { pathsStore, store } = setupDb(undefined);
    store.save([{ isFolder: false, path: 'a.md' }]);

    expect(pathsStore.put).not.toHaveBeenCalled();
  });

  it('reuses the open database on a second load', async () => {
    const { openFn, store } = setupDb(undefined);
    await store.load();
    await store.load();

    expect(openFn).toHaveBeenCalledTimes(1);
  });
});
