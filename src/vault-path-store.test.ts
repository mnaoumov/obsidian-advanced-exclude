import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { VaultModelEntry } from './vault-model.ts';
import type { StoredVaultPaths } from './vault-path-store.ts';

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

function setupDb(getValue: StoredVaultPaths | undefined | VaultModelEntry[]): SetupResult {
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
  it('loads a persisted record with its universe signature', async () => {
    const entries: VaultModelEntry[] = [{ isFolder: false, path: 'a.md' }];
    const { store } = setupDb({ entries, universeSignature: '1:abc' });
    expect(await store.load()).toEqual({ entries, universeSignature: '1:abc' });
  });

  it('reads a legacy bare-array record as entries with no signature', async () => {
    const entries: VaultModelEntry[] = [{ isFolder: false, path: 'a.md' }];
    const { store } = setupDb(entries);
    expect(await store.load()).toEqual({ entries, universeSignature: null });
  });

  it('returns an empty set with no signature when nothing is persisted', async () => {
    const { store } = setupDb(undefined);
    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
  });

  it('saves entries and the universe signature after the database is open', async () => {
    const { pathsStore, store } = setupDb(undefined);
    await store.load();

    const entries: VaultModelEntry[] = [{ isFolder: true, path: 'folder' }];
    store.save(entries, '1:sig');

    expect(pathsStore.put).toHaveBeenCalledWith({ entries, universeSignature: '1:sig' }, 'paths');
  });

  it('does not save when the database is not open', () => {
    const { pathsStore, store } = setupDb(undefined);
    store.save([{ isFolder: false, path: 'a.md' }], '1:sig');

    expect(pathsStore.put).not.toHaveBeenCalled();
  });

  it('reuses the open database on a second load', async () => {
    const { openFn, store } = setupDb(undefined);
    await store.load();
    await store.load();

    expect(openFn).toHaveBeenCalledTimes(1);
  });
});
