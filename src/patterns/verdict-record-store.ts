import { getResult } from '../indexed-database-utils.ts';
import { readLegacyDatabase } from '../legacy-database.ts';
import { LocalRecordStore } from '../local-record-store.ts';

const MTIME_STORE_NAME = 'mtime';
const FILES_STORE_NAME = 'files';

interface DatabaseFileEntry {
  readonly isIgnored: boolean;
  readonly path: string;
}

export function checkDatabaseFileEntry(value: unknown): value is DatabaseFileEntry {
  return !!value && typeof value === 'object' && 'path' in value && typeof value.path === 'string'
    && 'isIgnored' in value && typeof value.isIgnored === 'boolean';
}

export function createVerdictRecordStore(appId: string): LocalRecordStore {
  const store = new LocalRecordStore({
    factory: window.indexedDB,
    importLegacy: async (): Promise<readonly (readonly [string, unknown])[]> =>
      await readLegacyDatabase({
        factory: window.indexedDB,
        name: `${appId}/advanced-exclude`,
        async read(database): Promise<[string, unknown][]> {
          if (!database.objectStoreNames.contains(FILES_STORE_NAME) || !database.objectStoreNames.contains(MTIME_STORE_NAME)) {
            throw new Error('Legacy verdict stores are missing');
          }
          const transaction = database.transaction([FILES_STORE_NAME, MTIME_STORE_NAME]);
          const filesRequest = transaction.objectStore(FILES_STORE_NAME).getAll();
          const metadataRequest = transaction.objectStore(MTIME_STORE_NAME).get(0);
          const files: unknown[] = await getResult(filesRequest);
          const metadata: unknown = await getResult(metadataRequest);
          const entries: [string, unknown][] = [['fingerprint', metadata]];

          for (const entry of files) {
            if (!checkDatabaseFileEntry(entry)) {
              continue;
            }
            entries.push([`path:${entry.path}`, entry]);
          }
          return entries;
        }
      }),
    storeId: 'verdicts-v1',
    vaultId: appId
  });
  return store;
}
