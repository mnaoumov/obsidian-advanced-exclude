import type { App } from 'obsidian';

import { Notice } from 'obsidian';
import { configureCommunityPlugin } from 'obsidian-dev-utils/obsidian/community-plugins';

const PLUGIN_ID = 'advanced-exclude';

interface DemoSettingsPatch {
  excludeMode?: string;
  obsidianIgnoreContent?: string;
  shouldHideEmptyFolders?: boolean;
  shouldIgnoreExcludedFiles?: boolean;
  shouldIncludeGitIgnorePatterns?: boolean;
}

/**
 * Replaces the ignore patterns with `content` and applies them.
 *
 * Multi-line gitignore text is the one thing a settings text area is worst at — it has to be typed
 * exactly, and a single missing `!*/` silently changes the result — so every pattern set this vault
 * teaches gets a button.
 *
 * Manual equivalent: paste the same lines into **Ignore patterns** in **Settings -> Community plugins
 * -> Advanced Exclude** and click **Apply**. The same text also lives in `.obsidianignore` at the vault
 * root, which you can edit directly.
 */
export async function setIgnorePatterns(app: App, obsidianIgnoreContent: string): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { obsidianIgnoreContent } });
  new Notice('Patterns applied. Look at the Files pane.');
}

/**
 * Hides the `Archive/` folder and everything under it — the walkthrough in `01 Exclude a folder.md`.
 *
 * Manual equivalent: add the single line `Archive/` to **Ignore patterns** and apply.
 */
export async function excludeArchiveFolder(app: App): Promise<void> {
  await setIgnorePatterns(app, 'Archive/\n');
}

/**
 * The whitelist idiom from `02 Whitelist with negation.md`: ignore everything, keep folders
 * traversable, then re-include only markdown.
 *
 * The middle line is the one everybody forgets — without `!*/` the negation below it cannot reach
 * into any folder, because gitignore will not re-include a file whose parent is excluded.
 *
 * Manual equivalent: paste those four lines into **Ignore patterns** and apply.
 */
export async function useMarkdownWhitelist(app: App): Promise<void> {
  await setIgnorePatterns(app, ['# Ignore everything...', '*', '# ...but keep folders traversable...', '!*/', '# ...and re-include only Markdown notes.', '!*.md', ''].join('\n'));
}

/**
 * Clears every pattern, so the whole vault is visible again.
 *
 * Manual equivalent: empty the **Ignore patterns** text area and apply.
 */
export async function clearIgnorePatterns(app: App): Promise<void> {
  await setIgnorePatterns(app, '');
  new Notice('Patterns cleared — everything is visible again.');
}

/**
 * Applies any other settings patch, live.
 *
 * Manual equivalent: change the same option in **Settings -> Community plugins -> Advanced Exclude**.
 */
export async function changeSettings(app: App, patch: DemoSettingsPatch): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: patch });
  new Notice('Applied.');
}
