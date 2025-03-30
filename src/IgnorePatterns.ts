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

export async function getIgnorePatternsStr(plugin: AdvancedExcludePlugin): Promise<string> {
  const app = plugin.app;
  const doesIgnoreFileExist = await safeExists(app, OBSIDIAN_IGNORE_FILE);
  return doesIgnoreFileExist ? await safeRead(app, OBSIDIAN_IGNORE_FILE) : '';
}

export async function isIgnored(normalizedPath: string, plugin: AdvancedExcludePlugin): Promise<boolean> {
  if (normalizedPath === ROOT_PATH) {
    return false;
  }

  const ignoreTester = await getIgnoreTester(plugin);
  const excludeRegExps = getExcludeRegExps(plugin);
  return ignoreTester.ignores(normalizedPath) || excludeRegExps.some((regExp) => regExp.test(normalizedPath));
}

export async function setIgnorePatternsStr(plugin: AdvancedExcludePlugin, ignorePatterns: string): Promise<void> {
  const app = plugin.app;
  await app.vault.adapter.write(OBSIDIAN_IGNORE_FILE, ignorePatterns);
  await plugin.updateFileTree();
}

async function safeExists(app: App, path: string): Promise<boolean> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    return adapter.fs.existsSync(fullPath);
  }

  return await adapter.exists(path);
}

async function safeRead(app: App, path: string): Promise<string> {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const fullPath = adapter.getFullPath(path);
    return adapter.fs.readFileSync(fullPath, 'utf8');
  }

  return await adapter.read(path);
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

async function getIgnoreTester(plugin: AdvancedExcludePlugin): Promise<ignore.Ignore> {
  const stat = await statSafe(plugin.app, OBSIDIAN_IGNORE_FILE);
  const currentObsidianIgnoreFileMtime = stat?.mtime ?? 0;
  if (currentObsidianIgnoreFileMtime !== cachedObsidianIgnoreFileMtime) {
    cachedIgnoreTester = null;
    cachedObsidianIgnoreFileMtime = currentObsidianIgnoreFileMtime;
  }

  if (cachedIgnoreTester) {
    return cachedIgnoreTester;
  }

  const ignorePatternsStr = await getIgnorePatternsStr(plugin);
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
