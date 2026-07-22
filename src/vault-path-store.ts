import type { VaultModelEntry } from './vault-model.ts';

import { getResult } from './indexed-db-utils.ts';

const DB_VERSION = 1;
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
  load(): Promise<StoredVaultPaths>;
  save(entries: readonly VaultModelEntry[], universeSignature: string): void;
}

/**
 * The raw value stored under {@link PATHS_KEY}: the current struct, or a legacy
 * bare array written by an older plugin version.
 */
type PersistedValue = StoredVaultPaths | VaultModelEntry[];

export class IndexedDbVaultPathStore implements VaultPathStore {
  private database: IDBDatabase | null = null;
  private readonly dbName: string;

  public constructor(appId: string) {
    this.dbName = `${appId}/advanced-exclude-vault-paths`;
  }

  public async load(): Promise<StoredVaultPaths> {
    const database = await this.openDatabase();
    const store = database.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
    const value = await getResult(store.get(PATHS_KEY)) as PersistedValue | undefined;
    return normalizeStoredValue(value);
  }

  /**
   * Persists the hidden set and its universe signature immediately. `load()` must
   * have run first so the database is open; builds are infrequent, so no debounce
   * is needed.
   */
  public save(entries: readonly VaultModelEntry[], universeSignature: string): void {
    if (!this.database) {
      return;
    }
    const transaction = this.database.transaction([STORE_NAME], 'readwrite');
    const stored: StoredVaultPaths = { entries: [...entries], universeSignature };
    transaction.objectStore(STORE_NAME).put(stored, PATHS_KEY);
    // Commit explicitly so the write lands before a disable/enable abandons the connection.
    transaction.commit();
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (this.database) {
      return this.database;
    }

    const request = window.indexedDB.open(this.dbName, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE_NAME);
    });
    this.database = await getResult(request);
    return this.database;
  }
}

/**
 * Coerces the raw persisted value into a {@link StoredVaultPaths}: a missing value
 * yields an empty set with no signature; a legacy bare array yields its entries
 * with a `null` signature (fast-enable ineligible).
 */
function normalizeStoredValue(value: PersistedValue | undefined): StoredVaultPaths {
  if (!value) {
    return { entries: [], universeSignature: null };
  }
  if (Array.isArray(value)) {
    return { entries: value, universeSignature: null };
  }
  return { entries: value.entries, universeSignature: value.universeSignature };
}
