import type {
  App,
  Stat
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  CapacitorAdapter,
  FileSystemAdapter
} from 'obsidian';

import { isOutsideVaultImportPath } from './profiles/profiles.ts';

interface WriteSafeParams {
  readonly app: App;
  readonly content: string;
  readonly path: string;
}

/**
 * Reads {@link path}, or returns `null` when it does not exist.
 */
export async function readIfExists(app: App, path: string): Promise<null | string> {
  if (!await doesExistSafe(app, path)) {
    return null;
  }

  const adapter = getDataAdapterEx(app);
  const fullPath = adapter.getFullPath(path);

  if (adapter instanceof FileSystemAdapter) {
    return await adapter.fsPromises.readFile(fullPath, 'utf-8');
  }
  if (adapter instanceof CapacitorAdapter) {
    return await adapter.fs.read(fullPath);
  }

  throw new Error('Unknown adapter');
}

/**
 * Reads a file an `@import file:` line names: a vault path through the vault adapter, an absolute path outside the
 * vault through the desktop file system. Returns `null` when the file does not exist or cannot be read, and on mobile
 * for an absolute path, which `resolveProfile` reports there as an error before anything reads it.
 */
export async function readImportedFile(app: App, path: string): Promise<null | string> {
  if (!isOutsideVaultImportPath(path)) {
    return await readIfExists(app, path);
  }

  const adapter = getDataAdapterEx(app);
  if (!(adapter instanceof FileSystemAdapter)) {
    return null;
  }

  try {
    return await adapter.fsPromises.readFile(path, 'utf-8');
  } catch (error) {
    // A missing file is reported by the caller like a missing vault file; anything else (a folder, no permission) is
    // logged too, since it imports nothing in the same way.
    if (!isMissingFileError(error)) {
      console.warn(`Could not read \`${path}\`, imported with \`@import file:\`.`, error);
    }
    return null;
  }
}

export async function readSafe(app: App, path: string): Promise<string> {
  return await readIfExists(app, path) ?? '';
}

export async function statSafe(app: App, path: string): Promise<null | Stat> {
  if (!await doesExistSafe(app, path)) {
    return null;
  }

  const adapter = getDataAdapterEx(app);
  const fullPath = adapter.getFullPath(path);
  if (adapter instanceof FileSystemAdapter) {
    const fsStats = await adapter.fsPromises.stat(fullPath);
    return {
      ctime: Math.round(fsStats.birthtimeMs),
      mtime: Math.round(fsStats.mtimeMs),
      size: fsStats.size,
      type: fsStats.isFile() ? 'file' : 'directory'
    } as Stat;
  }
  if (adapter instanceof CapacitorAdapter) {
    const fsStats = await adapter.fs.stat(fullPath);
    return {
      ctime: fsStats.ctime ?? 0,
      mtime: fsStats.mtime ?? 0,
      size: fsStats.size ?? 0,
      type: fsStats.type
    } as Stat;
  }
  throw new Error('Unknown adapter');
}

export async function writeSafe(params: WriteSafeParams): Promise<void> {
  const { app, content, path } = params;
  const adapter = getDataAdapterEx(app);
  const fullPath = adapter.getFullPath(path);

  if (adapter instanceof FileSystemAdapter) {
    await adapter.fsPromises.writeFile(fullPath, content);
    return;
  }

  if (adapter instanceof CapacitorAdapter) {
    await adapter.fs.write(fullPath, content);
    return;
  }

  throw new Error('Unknown adapter');
}

async function doesExistSafe(app: App, path: string): Promise<boolean> {
  const adapter = getDataAdapterEx(app);
  const fullPath = adapter.getFullPath(path);

  if (adapter instanceof FileSystemAdapter) {
    try {
      await adapter.fsPromises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
  if (adapter instanceof CapacitorAdapter) {
    try {
      await adapter.fs.stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  throw new Error('Unknown adapter');
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}
