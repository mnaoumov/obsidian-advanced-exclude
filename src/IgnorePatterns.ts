import type { App } from 'obsidian';

import ignore from 'ignore';
import { escapeRegExp } from 'obsidian-dev-utils/RegExp';

import type { Plugin } from './Plugin.ts';

import {
  readSafe,
  statSafe,
  writeSafe
} from './DataAdapterSafe.ts';

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

export async function isIgnored(normalizedPath: string, plugin: Plugin, isFolder: boolean): Promise<boolean> {
  if (!plugin._loaded) {
    return false;
  }

  if (normalizedPath === ROOT_PATH) {
    return false;
  }

  const ignoreTester = await getIgnoreTester(plugin);
  const excludeRegExps = getExcludeRegExps(plugin);

  const pathsToCheck = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
  return pathsToCheck.some((path) => ignoreTester.ignores(path) || excludeRegExps.some((regExp) => regExp.test(path)));
}

export async function setIgnorePatternsStr(app: App, ignorePatterns: string): Promise<void> {
  await writeSafe(app, OBSIDIAN_IGNORE_FILE, ignorePatterns);
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
