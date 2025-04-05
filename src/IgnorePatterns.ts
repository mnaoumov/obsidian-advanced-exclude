import type {
  App,
  Stat
} from 'obsidian';

import ignore from 'ignore';
import {
  CapacitorAdapter,
  FileSystemAdapter
} from 'obsidian';
import { escapeRegExp } from 'obsidian-dev-utils/RegExp';

import type { Plugin } from './Plugin.ts';

export const ROOT_PATH = '/';
export const OBSIDIAN_IGNORE_FILE = '.obsidianignore';
export const GIT_IGNORE_FILE = '.gitignore';

let cachedExcludeRegExps: null | RegExp[] = null;
let cachedIgnoreTester: ignore.Ignore | null = null;
const cachedModificationTimes = new Map<string, number>();

export function clearCachedExcludeRegExps(): void {
  cachedExcludeRegExps = null;
}

export async function getIgnorePatternsStr(plugin: Plugin): Promise<string> {
  return await readSafe(plugin.app, OBSIDIAN_IGNORE_FILE);
}

export async function isIgnoreConfigFileChanged(plugin: Plugin, path: string): Promise<boolean> {
  const configFiles = getConfigFiles(plugin);
  if (!configFiles.includes(path)) {
    return false;
  }

  const stat = await statSafe(plugin.app, path);
  const mtime = stat?.mtime ?? 0;
  const isChanged = mtime !== (cachedModificationTimes.get(path) ?? 0);
  cachedModificationTimes.set(path, mtime);
  cachedIgnoreTester = null;
  return isChanged;
}

export async function isIgnored(normalizedPath: string, plugin: Plugin): Promise<boolean> {
  if (!plugin._loaded) {
    return false;
  }

  if (normalizedPath === ROOT_PATH) {
    return false;
  }

  const ignoreTester = await getIgnoreTester(plugin);
  const excludeRegExps = getExcludeRegExps(plugin);
  return ignoreTester.ignores(normalizedPath) || excludeRegExps.some((regExp) => regExp.test(normalizedPath));
}

export async function setIgnorePatternsStr(app: App, ignorePatterns: string): Promise<void> {
  await writeSafe(app, OBSIDIAN_IGNORE_FILE, ignorePatterns);
}

async function existsSafe(app: App, path: string): Promise<boolean> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    try {
      await adapter.fsPromises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  return await adapter.exists(path);
}

async function getAllIgnorePatternsStr(plugin: Plugin): Promise<string> {
  const configFiles = getConfigFiles(plugin);

  let patternsStr = '';

  for (const configFile of configFiles) {
    const content = await readSafe(plugin.app, configFile);
    if (content) {
      patternsStr += `${content}\n`;
    }
  }

  return patternsStr;
}

function getConfigFiles(plugin: Plugin): string[] {
  const configFiles = [OBSIDIAN_IGNORE_FILE];
  if (plugin.settings.shouldIncludeGitIgnorePatterns) {
    configFiles.push(GIT_IGNORE_FILE);
  }
  return configFiles;
}

function getExcludeRegExps(plugin: Plugin): RegExp[] {
  if (!plugin.settings.shouldIgnoreExcludedFiles) {
    return [];
  }

  if (cachedExcludeRegExps) {
    return cachedExcludeRegExps;
  }

  const filters = (plugin.app.vault.getConfig('userIgnoreFilters') ?? []) as string[];
  const excludeRegExps = filters.map((filter) => {
    if (filter.length > 1 && filter.startsWith('/') && filter.endsWith('/')) {
      try {
        return new RegExp(filter.slice(1, -1), 'i');
      } catch {
        console.error(`Invalid exclude filter: ${filter}`);
        return null;
      }
    }
    return new RegExp(`^${escapeRegExp(filter)}`, 'i');
  }).filter((regExp) => !!regExp);
  cachedExcludeRegExps = excludeRegExps;
  return excludeRegExps;
}

async function getIgnoreTester(plugin: Plugin): Promise<ignore.Ignore> {
  if (cachedIgnoreTester) {
    return cachedIgnoreTester;
  }

  const ignorePatternsStr = await getAllIgnorePatternsStr(plugin);
  // eslint-disable-next-line require-atomic-updates
  cachedIgnoreTester = ignore({
    ignoreCase: true
  }).add(ignorePatternsStr.split('\n'));
  return cachedIgnoreTester;
}

async function readSafe(app: App, path: string): Promise<string> {
  if (!await existsSafe(app, path)) {
    return '';
  }

  const adapter = app.vault.adapter;
  const fullPath = adapter.getFullPath(path);

  if (adapter instanceof FileSystemAdapter) {
    return await adapter.fsPromises.readFile(fullPath, 'utf8');
  }
  if (adapter instanceof CapacitorAdapter) {
    return await adapter.fs.read(fullPath);
  }

  throw new Error('Unknown adapter');
}

async function statSafe(app: App, path: string): Promise<null | Stat> {
  const adapter = app.vault.adapter;
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

async function writeSafe(app: App, path: string, content: string): Promise<void> {
  const adapter = app.vault.adapter;
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
