import ignore from 'ignore';
import { Component } from 'obsidian';
import { escapeRegExp } from 'obsidian-dev-utils/RegExp';

import type { Plugin } from './Plugin.ts';

import {
  readSafe,
  writeSafe
} from './DataAdapterSafe.ts';

export const ROOT_PATH = '/';
export const OBSIDIAN_IGNORE_FILE = '.obsidianignore';
export const GIT_IGNORE_FILE = '.gitignore';

export class IgnorePatternsComponent extends Component {
  private cachedExcludeRegExps: null | RegExp[] = null;
  private cachedGitIgnoreContent = '';
  private cachedIgnoreTester: ignore.Ignore | null = null;
  private cachedObsidianIgnoreContent = '';
  private reloadPromise: Promise<void> = Promise.resolve();

  public constructor(private plugin: Plugin) {
    super();
  }

  public async checkForConfigChanges(normalizedPath: string): Promise<void> {
    let shouldRefresh = false;
    if (normalizedPath === OBSIDIAN_IGNORE_FILE) {
      shouldRefresh ||= await this.readObsidianIgnore();
    }

    if (normalizedPath === GIT_IGNORE_FILE) {
      shouldRefresh ||= await this.readGitIgnore();
    }

    if (shouldRefresh) {
      await this.plugin.updateFileTree();
    }
  }

  public clearCachedExcludeRegExps(): void {
    this.cachedExcludeRegExps = null;
  }

  public async isIgnored(normalizedPath: string, isFolder: boolean): Promise<boolean> {
    if (!this.plugin._loaded) {
      return false;
    }

    if (normalizedPath === ROOT_PATH) {
      return false;
    }

    await this.reloadPromise;

    const ignoreTester = this.getIgnoreTester();
    const excludeRegExps = this.getExcludeRegExps();

    const pathsToCheck = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    return pathsToCheck.some((path) => ignoreTester.ignores(path) || excludeRegExps.some((regExp) => regExp.test(path)));
  }

  public override onload(): void {
    super.onload();
    this.reloadPromise = this.reload();
  }

  public async readGitIgnore(): Promise<boolean> {
    if (!this.plugin.settings.shouldIncludeGitIgnorePatterns) {
      this.cachedGitIgnoreContent = '';
      return false;
    }

    const gitIgnoreContent = await readSafe(this.plugin.app, GIT_IGNORE_FILE);
    if (gitIgnoreContent === this.cachedGitIgnoreContent) {
      return false;
    }

    this.cachedGitIgnoreContent = gitIgnoreContent;
    return true;
  }

  public async readObsidianIgnore(): Promise<boolean> {
    const obsidianIgnoreContent = await readSafe(this.plugin.app, OBSIDIAN_IGNORE_FILE);
    if (obsidianIgnoreContent === this.cachedObsidianIgnoreContent) {
      return false;
    }

    await this.plugin.settingsManager.setProperty('obsidianIgnoreContent', obsidianIgnoreContent);
    this.cachedObsidianIgnoreContent = obsidianIgnoreContent;
    return true;
  }

  public async reload(obsidianIgnoreContent?: string): Promise<void> {
    this.cachedIgnoreTester = null;
    if (obsidianIgnoreContent === undefined) {
      await this.readObsidianIgnore();
    } else {
      await this.writeObsidianIgnore(obsidianIgnoreContent);
    }
    await this.readGitIgnore();
  }

  public async writeObsidianIgnore(obsidianIgnoreContent: string): Promise<void> {
    if (this.cachedObsidianIgnoreContent === obsidianIgnoreContent) {
      return;
    }

    await writeSafe(this.plugin.app, OBSIDIAN_IGNORE_FILE, obsidianIgnoreContent);
    await this.plugin.settingsManager.setProperty('obsidianIgnoreContent', obsidianIgnoreContent);
    this.cachedObsidianIgnoreContent = obsidianIgnoreContent;
  }

  private getExcludeRegExps(): RegExp[] {
    if (!this.plugin.settings.shouldIgnoreExcludedFiles) {
      return [];
    }

    if (this.cachedExcludeRegExps) {
      return this.cachedExcludeRegExps;
    }

    const filters = (this.plugin.app.vault.getConfig('userIgnoreFilters') ?? []) as string[];
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
    this.cachedExcludeRegExps = excludeRegExps;
    return excludeRegExps;
  }

  private getIgnoreTester(): ignore.Ignore {
    if (this.cachedIgnoreTester) {
      return this.cachedIgnoreTester;
    }

    const ignorePatternsStr = `${this.cachedObsidianIgnoreContent}\n${this.cachedGitIgnoreContent}`;

    this.cachedIgnoreTester = ignore({
      ignoreCase: true
    }).add(ignorePatternsStr.split('\n'));
    return this.cachedIgnoreTester;
  }
}
