import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { IDBFactory } from 'fake-indexeddb';
import { locks } from 'node:worker_threads';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { LocalRecordStore } from './local-record-store.ts';

describe('LocalRecordStore', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'locks', { configurable: true, value: locks });
  });

  it('discards an older instance batch after a newer instance resets the full fingerprint', async () => {
    const factory = new IDBFactory();
    const first = new LocalRecordStore({ factory, importLegacy: (): Promise<[]> => Promise.resolve([]), storeId: 'conditional', vaultId: 'v' });
    const second = new LocalRecordStore({ factory, importLegacy: (): Promise<[]> => Promise.resolve([]), storeId: 'conditional', vaultId: 'v' });
    const before = { localMtime: 1, patterns: 'before' };
    const after = { localMtime: 2, patterns: 'after' };
    await first.commit({ entries: [['fingerprint', before]] });
    await first.commit({ entries: [['path:valid', true]], expectedFingerprint: JSON.stringify(before) });
    expect(await first.get('path:valid')).toBe(true);
    await second.replace({ entries: [['fingerprint', after]], keyPrefix: 'path:' });
    await first.commit({ entries: [['path:stale', true]], expectedFingerprint: JSON.stringify(before) });
    expect(await second.get('path:stale')).toBeUndefined();
    expect(await second.get('fingerprint')).toEqual(after);
    await Promise.all([first.close(), second.close()]);
  });
  it('rejects operations after close and rolls back the entire import when one record cannot be cloned', async () => {
    const factory = new IDBFactory();
    const failed = new LocalRecordStore({
      factory,
      importLegacy: (): Promise<[string, unknown][]> => Promise.resolve([['good', 1], ['bad', (): number => 1]]),
      storeId: 'broken',
      vaultId: 'v'
    });
    await expect(failed.entries()).rejects.toThrow();
    await failed.close();
    await expect(failed.get('good')).rejects.toThrow('closed');
    const retry = new LocalRecordStore({ factory, importLegacy: (): Promise<[]> => Promise.resolve([]), storeId: 'broken', vaultId: 'v' });
    expect(await retry.get('good')).toBeUndefined();
    await retry.close();
  });
  it('imports records and marker once and preserves subsequent writes across restart', async () => {
    const factory = new IDBFactory();
    let imports = 0;
    function open(): LocalRecordStore {
      return new LocalRecordStore({
        factory,
        importLegacy(): Promise<[string, unknown][]> {
          imports++;
          return Promise.resolve([['path', 'legacy']]);
        },
        storeId: 'test-v1',
        vaultId: 'vault'
      });
    }
    const first = open();
    expect(await first.get('path')).toBe('legacy');
    await first.commit({ entries: [['path', 'new']] });
    await first.close();
    const second = open();
    expect(await second.get('path')).toBe('new');
    expect(imports).toBe(1);
    await second.close();
  });

  it('retries a failed import without marking partial data as imported', async () => {
    const factory = new IDBFactory();
    const failed = new LocalRecordStore({ factory, importLegacy: (): Promise<[]> => Promise.reject(new Error('read failed')), storeId: 's', vaultId: 'v' });
    await expect(failed.get('a')).rejects.toThrow('read failed');
    await failed.close();
    const retry = new LocalRecordStore({ factory, importLegacy: (): Promise<[string, unknown][]> => Promise.resolve([['a', 1]]), storeId: 's', vaultId: 'v' });
    expect(await retry.get('a')).toBe(1);
    await retry.close();
  });

  it('drains accepted writes during open before closing and isolates vaults and stores', async () => {
    const close = vi.spyOn(LocalDataStore.prototype, 'close');
    const factory = new IDBFactory();
    function create(vaultId: string, storeId: string): LocalRecordStore {
      return new LocalRecordStore({ factory, importLegacy: (): Promise<[]> => Promise.resolve([]), storeId, vaultId });
    }
    const first = create('v', 's');
    const write = first.commit({ entries: [['a', 42]] });
    const closing = first.close();
    await write;
    await closing;
    expect(close).toHaveBeenCalledOnce();
    const restored = create('v', 's');
    expect(await restored.get('a')).toBe(42);
    const otherVault = create('other', 's');
    const otherStore = create('v', 'other');
    expect(await otherVault.get('a')).toBeUndefined();
    expect(await otherStore.get('a')).toBeUndefined();
    await Promise.all([restored.close(), otherVault.close(), otherStore.close()]);
  });
});
