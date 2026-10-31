import type { LocalDataStoreCommitParams } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

const MIGRATION_KEY = 'migration:legacy-v1';

interface LocalRecordStoreCommitParams extends LocalDataStoreCommitParams {
  readonly expectedFingerprint?: string;
}

interface LocalRecordStoreConstructorParams {
  readonly factory: IDBFactory;
  readonly importLegacy: () => Promise<readonly (readonly [string, unknown])[]>;
  readonly storeId: string;
  readonly vaultId: string;
}

interface LocalRecordStoreReplaceParams {
  readonly entries: readonly (readonly [string, unknown])[];
}

/**
Serializes import and accepted operations, draining them before connection disposal.
*/
export class LocalRecordStore {
  private readonly factory: IDBFactory;
  private readonly importLegacy: LocalRecordStoreConstructorParams['importLegacy'];
  private isClosed = false;
  private openPromise: null | Promise<LocalDataStore> = null;
  private readonly storeId: string;
  private tail: Promise<unknown> = Promise.resolve(undefined);
  private readonly vaultId: string;

  public constructor(params: LocalRecordStoreConstructorParams) {
    this.factory = params.factory;
    this.importLegacy = params.importLegacy;
    this.storeId = params.storeId;
    this.vaultId = params.vaultId;
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    await this.tail;
    const store = await this.openPromise?.catch(() => undefined);
    store?.close();
  }

  public async commit(params: LocalRecordStoreCommitParams): Promise<void> {
    await this.run(async (store) => {
      // An old instance may still be draining after a new instance reset the store.
      if (params.expectedFingerprint !== undefined && JSON.stringify(await store.get('fingerprint')) !== params.expectedFingerprint) {
        return;
      }
      await store.commit(params);
    });
  }

  public async entries(): Promise<[string, unknown][]> {
    return await this.run(async (store) => await store.entries());
  }

  public async get(key: string): Promise<unknown> {
    return await this.run(async (store) => await store.get(key));
  }

  /**
  Replaces every record in one transaction, re-seeding the migration marker with it so a restart cannot reimport legacy state.
  */
  public async replace(params: LocalRecordStoreReplaceParams): Promise<void> {
    await this.run(async (store) => {
      await store.commit({ entries: [...params.entries, [MIGRATION_KEY, true]], shouldClear: true });
    });
  }

  private async importRecords(): Promise<LocalDataStore> {
    const store = await LocalDataStore.open({
      factory: this.factory,
      pluginId: 'advanced-exclude',
      storeId: this.storeId,
      vaultId: this.vaultId
    });
    try {
      if (await store.get(MIGRATION_KEY) !== true) {
        const entries = await this.importLegacy();
        // The marker must never survive without ALL imported records.
        await store.commit({ entries: [...entries, [MIGRATION_KEY, true]] });
      }
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  private async open(): Promise<LocalDataStore> {
    this.openPromise ??= this.importRecords();
    return await this.openPromise;
  }

  private async run<T>(action: (store: LocalDataStore) => Promise<T>): Promise<T> {
    if (this.isClosed) {
      throw new Error('Local record store is closed');
    }
    // Request synchronously: a fresh plugin instance must queue behind accepted writes
    // from an unloading one, even when they use different bundled library copies.
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Web Locks run in Obsidian's renderer, not Node.
    const operation = window.navigator.locks.request(
      `advanced-exclude:${JSON.stringify([this.vaultId, this.storeId])}`,
      async () => await action(await this.open())
    );
    // A failed operation is returned to its caller, without poisoning the drain.
    this.tail = Promise.all([this.tail, operation.catch(() => undefined)]);
    return await operation;
  }
}
