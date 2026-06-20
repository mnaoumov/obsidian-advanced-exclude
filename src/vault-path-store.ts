import type { VaultModelEntry } from './vault-model.ts';

import { getResult } from './indexed-db-utils.ts';

const DB_VERSION = 1;
const STORE_NAME = 'paths';
const PATHS_KEY = 'paths';

/**
 * Persists the complete known path set so a fresh plugin instance can
 * reconstruct the full vault tree without re-scanning disk — needed because
 * Obsidian's in-memory file list omits paths the plugin previously hid.
 */
export interface VaultPathStore {
  load(): Promise<VaultModelEntry[]>;
  save(entries: readonly VaultModelEntry[]): void;
}

export class IndexedDbVaultPathStore implements VaultPathStore {
  private database: IDBDatabase | null = null;
  private readonly dbName: string;

  public constructor(appId: string) {
    this.dbName = `${appId}/advanced-exclude-vault-paths`;
  }

  public async load(): Promise<VaultModelEntry[]> {
    const database = await this.openDatabase();
    const store = database.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME);
    const value = await getResult(store.get(PATHS_KEY)) as undefined | VaultModelEntry[];
    return value ?? [];
  }

  /**
   * Persists the path set immediately. `load()` must have run first so the
   * database is open; builds are infrequent, so no debounce is needed.
   */
  public save(entries: readonly VaultModelEntry[]): void {
    if (!this.database) {
      return;
    }
    const transaction = this.database.transaction([STORE_NAME], 'readwrite');
    transaction.objectStore(STORE_NAME).put(entries, PATHS_KEY);
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
