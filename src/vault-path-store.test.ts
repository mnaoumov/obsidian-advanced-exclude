import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { VaultModelEntry } from './vault-model.ts';
import type { StoredVaultPaths } from './vault-path-store.ts';

import { IndexedDatabaseVaultPathStore } from './vault-path-store.ts';

interface MockPathsStore {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

interface PendingOpen {
  succeed?: () => void;
}

interface SetupResult {
  readonly mockDatabase: IDBDatabase;
  readonly openFunction: ReturnType<typeof vi.fn>;
  readonly pathsStore: MockPathsStore;
  readonly store: IndexedDatabaseVaultPathStore;
}

function createDoneRequest<T>(result: T): IDBRequest<T> {
  const request = { readyState: 'done' as IDBRequestReadyState, result };
  Object.defineProperty(request, 'addEventListener', { value: vi.fn() });
  return request as IDBRequest<T>;
}

function setupDatabase(getValue: StoredVaultPaths | undefined | VaultModelEntry[]): SetupResult {
  const pathsStore: MockPathsStore = {
    get: vi.fn().mockReturnValue(createDoneRequest(getValue)),
    put: vi.fn()
  };

  const mockDatabase = strictProxy<IDBDatabase>({ close: vi.fn(), createObjectStore: vi.fn() });
  Object.defineProperty(mockDatabase, 'transaction', {
    value: vi.fn(() => ({ commit: vi.fn(), objectStore: vi.fn(() => pathsStore) }))
  });

  // A pending open request that resolves via its `success` event (covers the async path).
  const openRequest = strictProxy<IDBOpenDBRequest>({ readyState: 'pending', result: mockDatabase });
  Object.defineProperty(openRequest, 'addEventListener', {
    value: vi.fn((event: string, handler: () => void) => {
      if (event === 'upgradeneeded' || event === 'success') {
        handler();
      }
    })
  });

  const openFunction = vi.fn().mockReturnValue(openRequest);
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: strictProxy<IDBFactory>({ open: openFunction }),
    writable: true
  });

  return { mockDatabase, openFunction, pathsStore, store: new IndexedDatabaseVaultPathStore('app-id') };
}

describe('IndexedDatabaseVaultPathStore', () => {
  it('loads a persisted record with its universe signature', async () => {
    const entries: VaultModelEntry[] = [{ isFolder: false, path: 'a.md' }];
    const { store } = setupDatabase({ entries, universeSignature: '1:abc' });
    expect(await store.load()).toEqual({ entries, universeSignature: '1:abc' });
  });

  it('reads a legacy bare-array record as entries with no signature', async () => {
    const entries: VaultModelEntry[] = [{ isFolder: false, path: 'a.md' }];
    const { store } = setupDatabase(entries);
    expect(await store.load()).toEqual({ entries, universeSignature: null });
  });

  it('returns an empty set with no signature when nothing is persisted', async () => {
    const { store } = setupDatabase(undefined);
    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
  });

  it('saves entries and the universe signature after the database is open', async () => {
    const { pathsStore, store } = setupDatabase(undefined);
    await store.load();

    const entries: VaultModelEntry[] = [{ isFolder: true, path: 'folder' }];
    store.save(entries, '1:sig');

    expect(pathsStore.put).toHaveBeenCalledWith({ entries, universeSignature: '1:sig' }, 'paths');
  });

  it('does not save when the database is not open', () => {
    const { pathsStore, store } = setupDatabase(undefined);
    store.save([{ isFolder: false, path: 'a.md' }], '1:sig');

    expect(pathsStore.put).not.toHaveBeenCalled();
  });

  it('closes the open database, after which a save is a no-op and a load reads nothing without reopening', async () => {
    const { mockDatabase, openFunction, pathsStore, store } = setupDatabase({ entries: [{ isFolder: false, path: 'a.md' }], universeSignature: '1:abc' });
    await store.load();

    store.close();
    store.save([{ isFolder: false, path: 'a.md' }], '1:sig');

    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
    expect(mockDatabase.close).toHaveBeenCalledOnce();
    expect(pathsStore.put).not.toHaveBeenCalled();
    expect(openFunction).toHaveBeenCalledOnce();
  });

  it('shares one open request between concurrent loads', async () => {
    const { openFunction, store } = setupDatabase(undefined);

    await Promise.all([store.load(), store.load()]);

    expect(openFunction).toHaveBeenCalledOnce();
  });

  it('closes a connection that finishes opening after close', async () => {
    const { mockDatabase, openFunction } = setupDatabase(undefined);
    const pendingOpen: PendingOpen = {};
    const openRequest = strictProxy<IDBOpenDBRequest>({ readyState: 'pending', result: mockDatabase });
    Object.defineProperty(openRequest, 'addEventListener', {
      value: vi.fn((event: string, handler: () => void) => {
        if (event === 'success') {
          pendingOpen.succeed = handler;
        }
      })
    });
    openFunction.mockReturnValue(openRequest);
    const store = new IndexedDatabaseVaultPathStore('app-id');

    const loadPromise = store.load();
    store.close();
    pendingOpen.succeed?.();

    expect(await loadPromise).toEqual({ entries: [], universeSignature: null });
    expect(mockDatabase.close).toHaveBeenCalledOnce();
  });

  it('closes nothing when the database was never opened', () => {
    const { mockDatabase, store } = setupDatabase(undefined);

    store.close();

    expect(mockDatabase.close).not.toHaveBeenCalled();
  });

  it('reuses the open database on a second load', async () => {
    const { openFunction, store } = setupDatabase(undefined);
    await store.load();
    await store.load();

    expect(openFunction).toHaveBeenCalledTimes(1);
  });
});
