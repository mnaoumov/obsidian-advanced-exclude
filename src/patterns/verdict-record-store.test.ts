import { IDBFactory } from 'fake-indexeddb';
import { locks } from 'node:worker_threads';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { getResult } from '../indexed-database-utils.ts';
import {
  checkDatabaseFileEntry,
  createVerdictRecordStore
} from './verdict-record-store.ts';

async function seedLegacy(shouldCreateStores: boolean): Promise<void> {
  const request = window.indexedDB.open('vault/advanced-exclude', 1);
  request.onupgradeneeded = (): void => {
    if (!shouldCreateStores) {
      return;
    }

    request.result.createObjectStore('files', { keyPath: 'path' });
    request.result.createObjectStore('mtime');
  };
  const database = await getResult(request);
  if (shouldCreateStores) {
    const transaction = database.transaction(['files', 'mtime'], 'readwrite');
    transaction.objectStore('files').put({ isIgnored: true, path: 'a.md' });
    transaction.objectStore('files').put({ isIgnored: 'invalid', path: 'invalid.md' });
    transaction.objectStore('mtime').put({ settingsFingerprint: 'full-config' }, 0);
    await new Promise<void>((resolve) => {
      transaction.oncomplete = (): void => {
        resolve();
      };
    });
  }
  database.close();
}

describe('verdict records migration', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'locks', { configurable: true, value: locks });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  });

  it('imports valid per-path verdicts and configuration metadata once and retains resets across restart', async () => {
    await seedLegacy(true);
    const first = createVerdictRecordStore('vault');
    expect(await first.get('fingerprint')).toEqual({ settingsFingerprint: 'full-config' });
    expect(await first.entries()).toContainEqual(['path:a.md', { isIgnored: true, path: 'a.md' }]);
    expect(await first.get('path:invalid.md')).toBeUndefined();
    await first.replace({ entries: [['fingerprint', { settingsFingerprint: 'new-config' }]], keyPrefix: 'path:' });
    await first.close();
    const restarted = createVerdictRecordStore('vault');
    expect(await restarted.get('path:a.md')).toBeUndefined();
    expect(await restarted.get('fingerprint')).toEqual({ settingsFingerprint: 'new-config' });
    await restarted.close();
  });

  it('initializes an absent legacy database without creating one', async () => {
    const store = createVerdictRecordStore('vault');
    expect(await store.get('fingerprint')).toBeUndefined();
    const databases = await window.indexedDB.databases();
    expect(databases.map((entry) => entry.name)).not.toContain('vault/advanced-exclude');
    await store.close();
  });

  it('rejects incomplete legacy schemas without treating them as empty successful imports', async () => {
    await seedLegacy(false);
    const store = createVerdictRecordStore('vault');
    await expect(store.get('fingerprint')).rejects.toThrow('Legacy verdict stores are missing');
    await store.close();
  });

  it.each([null, undefined, 1, {}, { isIgnored: true, path: 1 }, { path: 'a' }, { isIgnored: 1, path: 'a' }])('rejects malformed verdict rows: %j', (value) => {
    expect(checkDatabaseFileEntry(value)).toBe(false);
  });
});
