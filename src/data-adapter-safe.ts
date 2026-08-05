import type {
  App,
  Stat
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  CapacitorAdapter,
  FileSystemAdapter
} from 'obsidian';

interface WriteSafeParams {
  readonly app: App;
  readonly content: string;
  readonly path: string;
}

export async function readSafe(app: App, path: string): Promise<string> {
  if (!await doesExistSafe(app, path)) {
    return '';
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
