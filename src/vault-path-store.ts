import type { VaultModelEntry } from './vault-model.ts';

import { getResult } from './indexed-database-utils.ts';

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
  close: () => void;
  load: () => Promise<StoredVaultPaths>;
  save: (entries: readonly VaultModelEntry[], universeSignature: string) => void;
}

/**
 * The raw value stored under {@link PATHS_KEY}: the current struct, or a legacy
 * bare array written by an older plugin version.
 */
type PersistedValue = StoredVaultPaths | VaultModelEntry[];

export class IndexedDatabaseVaultPathStore implements VaultPathStore {
  private database: IDBDatabase | null = null;
  private readonly databaseName: string;
  private isClosed = false;
  private openPromise: null | Promise<IDBDatabase> = null;

  public constructor(appId: string) {
    this.databaseName = `${appId}/advanced-exclude-vault-paths`;
  }

  /**
   * Releases the connection. An open connection blocks every later `deleteDatabase` and version
   * upgrade, and each enable opened a new one, so a disable must let it go. A pending `save`
   * still lands: `close` waits for running transactions. A connection still opening is closed as
   * soon as it opens.
   */
  public close(): void {
    this.isClosed = true;
    this.database?.close();
    this.database = null;
  }

  public async load(): Promise<StoredVaultPaths> {
    const database = await this.openDatabase();
    // Closed by an unload: the caller is aborting, and a closed connection cannot start a transaction.
    if (this.isClosed) {
      return normalizeStoredValue(undefined);
    }
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

  /**
   * Opens the connection once. Concurrent callers share the one request, and a connection that
   * finishes opening after {@link close} is closed at once: either way a second connection would
   * never be closed, and would block every later `deleteDatabase`.
   */
  private async openDatabase(): Promise<IDBDatabase> {
    this.openPromise ??= this.requestDatabase();
    return await this.openPromise;
  }

  private async requestDatabase(): Promise<IDBDatabase> {
    const request = window.indexedDB.open(this.databaseName, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE_NAME);
    });
    const database = await getResult(request);
    if (this.isClosed) {
      database.close();
    } else {
      this.database = database;
    }
    return database;
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
  return Array.isArray(value) ? { entries: value, universeSignature: null } : { entries: value.entries, universeSignature: value.universeSignature };
}
