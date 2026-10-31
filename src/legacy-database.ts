import { getResult } from './indexed-database-utils.ts';

interface ReadLegacyDatabaseParams {
  readonly factory: IDBFactory;
  readonly name: string;
  readonly read: (database: IDBDatabase) => Promise<readonly (readonly [string, unknown])[]>;
}

/**
Reads a legacy database without deleting or upgrading an existing one.
*/
export async function readLegacyDatabase(params: ReadLegacyDatabaseParams): Promise<readonly (readonly [string, unknown])[]> {
  const request = params.factory.open(params.name);
  // Opening an absent database must not leave an empty legacy database behind.
  const state = { isAbsent: false };
  request.addEventListener('upgradeneeded', () => {
    state.isAbsent = true;
    request.transaction?.abort();
  });
  let database: IDBDatabase;
  try {
    database = await getResult(request);
  } catch (error) {
    if (state.isAbsent) {
      return [];
    }
    throw error;
  }
  try {
    return await params.read(database);
  } finally {
    database.close();
  }
}
