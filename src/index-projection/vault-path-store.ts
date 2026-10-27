import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';

import type { VaultModelEntry } from './vault-model.ts';

import { getResult } from '../indexed-database-utils.ts';
import { readLegacyDatabase } from '../legacy-database.ts';
import { LocalRecordStore } from '../local-record-store.ts';

const STORE_NAME = 'paths';
const PATHS_KEY = 'paths';

/**
 * The persisted hidden set plus a signature of the file universe it was captured
 * against. `universeSignature` is `null` for a legacy record written before the
 * signature existed (a bare `VaultModelEntry[]`), which makes it ineligible for
 * the fast-enable path — the caller falls back to a full recompute.
 */
export interface StoredVaultPaths {
  readonly entries: VaultModelEntry[];
  readonly universeSignature: null | string;
}

/**
 * Persists the hidden path set (merged with Obsidian's loaded tree on the next
 * build, this reconstructs the full vault tree without re-scanning disk — needed
 * because Obsidian's in-memory file list omits paths the plugin previously hid)
 * plus a {@link StoredVaultPaths.universeSignature} guarding the fast-enable path.
 */
export interface VaultPathStore {
  readonly close: () => void;
  readonly load: () => Promise<StoredVaultPaths>;
  readonly save: (entries: readonly VaultModelEntry[], universeSignature: string) => void;
}

export class IndexedDatabaseVaultPathStore implements VaultPathStore {
  private isClosed = false;
  private isLoaded = false;
  private readonly store: LocalRecordStore;

  public constructor(appId: string) {
    this.store = new LocalRecordStore({
      factory: window.indexedDB,
      importLegacy: async (): Promise<readonly (readonly [string, unknown])[]> =>
        await readLegacyDatabase({
          factory: window.indexedDB,
          name: `${appId}/advanced-exclude-vault-paths`,
          async read(database): Promise<[string, unknown][]> {
            if (!database.objectStoreNames.contains(STORE_NAME)) {
              throw new Error('Legacy hidden-path store is missing');
            }
            const value: unknown = await getResult(database.transaction(STORE_NAME).objectStore(STORE_NAME).get(PATHS_KEY));
            const paths = normalizeStoredValue(value);
            return [['universeSignature', paths.universeSignature], ...paths.entries.map((entry): [string, unknown] => [`path:${entry.path}`, entry])];
          }
        }),
      storeId: 'hidden-paths-v1',
      vaultId: appId
    });
  }

  public close(): void {
    this.isClosed = true;
    invokeAsyncSafely(async () => {
      await this.store.close();
    });
  }

  public async load(): Promise<StoredVaultPaths> {
    if (this.checkClosed()) {
      return { entries: [], universeSignature: null };
    }
    const records = await this.store.entries();
    if (this.checkClosed()) {
      return { entries: [], universeSignature: null };
    }
    this.isLoaded = true;
    return normalizeStoredValue({
      entries: records.filter(([key]) => key.startsWith('path:')).map(([, value]) => value),
      universeSignature: records.find(([key]) => key === 'universeSignature')?.[1] ?? null
    });
  }

  public save(entries: readonly VaultModelEntry[], universeSignature: string): void {
    if (!this.isLoaded || this.isClosed) {
      return;
    }
    const snapshot = [...entries];
    // Queue the replacement as one operation so concurrent saves cannot retain obsolete paths.
    invokeAsyncSafely(async () => {
      await this.store.replace({
        entries: [['universeSignature', universeSignature], ...snapshot.map((entry): [string, unknown] => [`path:${entry.path}`, entry])],
        keyPrefix: 'path:'
      });
    });
  }

  private checkClosed(): boolean {
    return this.isClosed;
  }
}

function checkEntry(value: unknown): value is VaultModelEntry {
  return !!value && typeof value === 'object' && 'path' in value && typeof value.path === 'string'
    && 'isFolder' in value && typeof value.isFolder === 'boolean';
}

function normalizeStoredValue(value: unknown): StoredVaultPaths {
  if (value === undefined) {
    return { entries: [], universeSignature: null };
  }
  const entries: unknown = Array.isArray(value) ? value : (value && typeof value === 'object' && 'entries' in value ? value.entries : undefined);
  if (!Array.isArray(entries) || !entries.every(checkEntry)) {
    throw new Error('Malformed hidden-path records; legacy database retained');
  }
  const signature: unknown = !Array.isArray(value) && value && typeof value === 'object' && 'universeSignature' in value ? value.universeSignature : null;
  if (signature !== null && typeof signature !== 'string') {
    throw new Error('Malformed universe signature; legacy database retained');
  }
  return { entries, universeSignature: signature };
}
