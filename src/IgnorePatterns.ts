import type {
  App,
  Stat
} from 'obsidian';

import ignore from 'ignore';
import { FileSystemAdapter } from 'obsidian';
import { escapeRegExp } from 'obsidian-dev-utils/RegExp';

import type { AdvancedExcludePlugin } from './AdvancedExcludePlugin.ts';

export const ROOT_PATH = '/';
export const OBSIDIAN_IGNORE_FILE = '.obsidianignore';
let cachedObsidianIgnoreFileMtime = 0;

export async function getIgnorePatternsStr(app: App): Promise<string> {
  const doesIgnoreFileExist = await existsSafe(app, OBSIDIAN_IGNORE_FILE);
  return doesIgnoreFileExist ? await readSafe(app, OBSIDIAN_IGNORE_FILE) : '';
}

export async function isIgnored(normalizedPath: string, plugin: AdvancedExcludePlugin): Promise<boolean> {
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

async function readSafe(app: App, path: string): Promise<string> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    return await adapter.fsPromises.readFile(fullPath, 'utf8');
  }

  return await adapter.read(path);
}

async function writeSafe(app: App, path: string, content: string): Promise<void> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    await adapter.fsPromises.writeFile(fullPath, content);
    return;
  }
  await adapter.write(path, content);
}

let cachedExcludeRegExps: null | RegExp[] = null;

function getExcludeRegExps(plugin: AdvancedExcludePlugin): RegExp[] {
  if (!plugin.settings.shouldIgnoreExcludedFiles) {
    return [];
  }

  if (cachedExcludeRegExps) {
    return cachedExcludeRegExps;
  }

  const filters = plugin.app.vault.getConfig('userIgnoreFilters') as string[];
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

let cachedIgnoreTester: ignore.Ignore | null = null;

export function clearCachedExcludeRegExps(): void {
  cachedExcludeRegExps = null;
}

export async function isObsidianIgnoreFileChanged(app: App): Promise<boolean> {
  const stat = await statSafe(app, OBSIDIAN_IGNORE_FILE);
  const obsidianIgnoreFileMtime = stat?.mtime ?? 0;
  const isChanged = obsidianIgnoreFileMtime !== cachedObsidianIgnoreFileMtime;
  cachedObsidianIgnoreFileMtime = obsidianIgnoreFileMtime;
  cachedIgnoreTester = null;
  return isChanged;
}

async function getIgnoreTester(plugin: AdvancedExcludePlugin): Promise<ignore.Ignore> {
  if (cachedIgnoreTester) {
    return cachedIgnoreTester;
  }

  const ignorePatternsStr = await getIgnorePatternsStr(plugin.app);
  // eslint-disable-next-line require-atomic-updates
  cachedIgnoreTester = ignore({
    ignoreCase: true
  }).add(ignorePatternsStr.split('\n'));
  return cachedIgnoreTester;
}

async function statSafe(app: App, path: string): Promise<null | Stat> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    const fsStats = await adapter.fsPromises.stat(fullPath);
    return {
      ctime: Math.round(fsStats.birthtimeMs),
      mtime: Math.round(fsStats.mtimeMs),
      size: fsStats.size,
      type: fsStats.isFile() ? 'file' : 'directory'
    } as Stat;
  }

  return await adapter.stat(path);
}
