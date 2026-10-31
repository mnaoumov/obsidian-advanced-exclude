import { IDBFactory } from 'fake-indexeddb';
import { locks } from 'node:worker_threads';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { getResult } from '../indexed-database-utils.ts';
import { LocalRecordStore } from '../local-record-store.ts';
import { IndexedDatabaseVaultPathStore } from './vault-path-store.ts';

async function readRecords(): Promise<[string, unknown][]> {
  const store = new LocalRecordStore({ factory: window.indexedDB, importLegacy: (): Promise<[]> => Promise.resolve([]), storeId: 'hidden-paths-v1', vaultId: 'app-id' });
  try {
    return await store.entries();
  } finally {
    await store.close();
  }
}

async function seedLegacy(value: unknown): Promise<void> {
  const request = window.indexedDB.open('app-id/advanced-exclude-vault-paths', 1);
  request.onupgradeneeded = (): void => {
    request.result.createObjectStore('paths');
  };
  const database = await getResult(request);
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('paths', 'readwrite');
    transaction.objectStore('paths').put(value, 'paths');
    transaction.oncomplete = (): void => {
      resolve();
    };
    transaction.addEventListener('abort', (): void => {
      reject(new Error('Transaction aborted', { cause: transaction.error }));
    });
  });
  database.close();
}

describe('IndexedDatabaseVaultPathStore', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'locks', { configurable: true, value: locks });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  it.each([null, 1, {}, { entries: [null] }, { entries: [{ isFolder: 1, path: 'a' }] }, { entries: [], universeSignature: 1 }])('retains malformed legacy state for recovery: %j', async (value) => {
    await seedLegacy(value);
    const store = new IndexedDatabaseVaultPathStore('app-id');
    await expect(store.load()).rejects.toThrow('Malformed');
    store.close();
  });

  it('rejects a missing legacy object store instead of marking the migration complete', async () => {
    const request = window.indexedDB.open('app-id/advanced-exclude-vault-paths', 1);
    const database = await getResult(request);
    database.close();
    const store = new IndexedDatabaseVaultPathStore('app-id');
    await expect(store.load()).rejects.toThrow('Legacy hidden-path store is missing');
    store.close();
  });

  it('treats absent optional legacy signatures as ineligible for fast enable', async () => {
    await seedLegacy({ entries: [] });
    const store = new IndexedDatabaseVaultPathStore('app-id');
    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
    store.close();
  });

  it('imports an existing legacy database with no saved hidden set as empty', async () => {
    await seedLegacy(undefined);
    const store = new IndexedDatabaseVaultPathStore('app-id');
    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
    store.close();
  });

  it.each([
    { entries: [{ isFolder: false, path: 'a.md' }], universeSignature: '1:abc' },
    [{ isFolder: false, path: 'a.md' }]
  ])('imports legacy structs and bare arrays without losing restoration paths: %j', async (legacy) => {
    await seedLegacy(legacy);
    const store = new IndexedDatabaseVaultPathStore('app-id');
    expect(await store.load()).toEqual({ entries: [{ isFolder: false, path: 'a.md' }], universeSignature: Array.isArray(legacy) ? null : '1:abc' });
    store.close();
    expect(await readRecords()).toContainEqual(['hiddenSet', { entries: [{ isFolder: false, path: 'a.md' }], universeSignature: Array.isArray(legacy) ? null : '1:abc' }]);
  });

  it('persists replacements and signatures across restart without reimporting old paths', async () => {
    await seedLegacy({ entries: [{ isFolder: false, path: 'old.md' }], universeSignature: 'old' });
    const first = new IndexedDatabaseVaultPathStore('app-id');
    await first.load();
    first.save([{ isFolder: false, path: 'new.md' }], 'new-signature');
    first.close();
    const second = new IndexedDatabaseVaultPathStore('app-id');
    expect(await second.load()).toEqual({ entries: [{ isFolder: false, path: 'new.md' }], universeSignature: 'new-signature' });
    second.close();
    // One record for the whole set, so a reload cannot land between the paths of a save.
    const records = await readRecords();
    expect(records.map(([key]) => key)).toEqual(['hiddenSet', 'migration:legacy-v1']);
  });

  it('rejects malformed hidden paths without importing a partial hidden set', async () => {
    await seedLegacy({ entries: [{ isFolder: true, path: 'ok' }, { path: 1 }], universeSignature: 'sig' });
    const store = new IndexedDatabaseVaultPathStore('app-id');
    await expect(store.load()).rejects.toThrow('Malformed hidden-path');
    store.close();
    const request = window.indexedDB.open('app-id/advanced-exclude-vault-paths');
    const legacy = await getResult(request);
    expect(await getResult(legacy.transaction('paths').objectStore('paths').get('paths'))).toMatchObject({ universeSignature: 'sig' });
    legacy.close();
  });

  it('handles absent legacy stores and closing during a pending open without reopening', async () => {
    const store = new IndexedDatabaseVaultPathStore('app-id');
    const pending = store.load();
    store.close();
    expect(await pending).toEqual({ entries: [], universeSignature: null });
    expect(await store.load()).toEqual({ entries: [], universeSignature: null });
    store.save([{ isFolder: true, path: 'late' }], 'late');
    expect(await readRecords()).not.toContainEqual(['hiddenSet', expect.objectContaining({ universeSignature: 'late' })]);
  });

  it('shares the pending import across concurrent loads', async () => {
    const store = new IndexedDatabaseVaultPathStore('app-id');
    expect(await Promise.all([store.load(), store.load()])).toEqual([{ entries: [], universeSignature: null }, { entries: [], universeSignature: null }]);
    store.close();
  });
});
