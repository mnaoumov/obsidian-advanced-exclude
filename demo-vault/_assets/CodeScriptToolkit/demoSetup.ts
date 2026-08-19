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
 * exactly, and dropping the keep-folders-traversable line alone silently changes the result — so every
 * pattern set this vault teaches gets a button.
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
 * The middle line — the one re-including every directory — is the one everybody forgets. Without it
 * the negation below cannot reach into any folder, because gitignore will not re-include a file whose
 * parent is excluded. It is spelled out in the array below, where it is a string rather than prose:
 * a literal comment-terminator sequence inside a block comment ENDS the comment, which is exactly how
 * this whole module was left failing to load until the button suite ran it.
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
