import type { App } from 'obsidian';

import { Notice } from 'obsidian';
import { configureCommunityPlugin } from '@mnaoumov/obsidian-lib/community-plugins';

const PLUGIN_ID = 'advanced-exclude';

interface DemoSettingsPatch {
  excludeMode?: string;
  ignorePatterns?: string;
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
 * -> `Advanced Exclude`** and click **Apply**.
 */
export async function setIgnorePatterns(app: App, ignorePatterns: string): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { ignorePatterns } });
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
 * Manual equivalent: change the same option in **Settings -> Community plugins -> `Advanced Exclude`**.
 */
export async function changeSettings(app: App, patch: DemoSettingsPatch): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: patch });
  new Notice('Applied.');
}

interface DemoProfile {
  id: string;
  name: string;
  patterns: string;
}

interface ProfileSwitcher {
  setActiveProfileId(profileId: null | string): Promise<void>;
}

const DEMO_PROFILES: DemoProfile[] = [
  { id: 'demo-hide-archive', name: 'Hide archive', patterns: 'Archive/' },
  { id: 'demo-focus', name: 'Focus', patterns: ['@import Hide archive', 'Shared/'].join('\n') }
];

/**
 * Creates the two profiles `05 Profiles.md` walks through: `Hide archive`, and `Focus`, which imports it and
 * hides `Shared/` as well.
 *
 * Manual equivalent: **Settings -> Community plugins -> `Advanced Exclude` -> Profiles -> Add profile**, once per
 * profile, with the same name and patterns.
 */
export async function createDemoProfiles(app: App): Promise<void> {
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { profiles: DEMO_PROFILES } });
  new Notice('Profiles created. Switch between them from the status bar or the "Switch profile..." command.');
}

/**
 * Makes `profileId` the active profile on this device, or goes back to the base settings for `null`.
 *
 * Manual equivalent: click the `Exclude:` item in the status bar and pick the profile, or run
 * **`Advanced Exclude`: Switch profile...**.
 */
export async function activateProfile(app: App, profileId: null | string): Promise<void> {
  const plugin = app.plugins.getPlugin(PLUGIN_ID) as unknown as null | { pluginSettingsComponent: ProfileSwitcher };
  if (!plugin) {
    new Notice('Enable Advanced Exclude first.');
    return;
  }
  await plugin.pluginSettingsComponent.setActiveProfileId(profileId);
  new Notice(profileId === null ? 'Back to the base settings.' : 'Profile active. Look at the Files pane.');
}

/**
 * Goes back to the base settings and deletes the demo profiles.
 *
 * Manual equivalent: pick **Base settings** in the status-bar menu, then **Delete** each profile in the settings.
 */
export async function removeDemoProfiles(app: App): Promise<void> {
  await activateProfile(app, null);
  await configureCommunityPlugin({ app, pluginId: PLUGIN_ID, settings: { profiles: [] } });
  new Notice('Demo profiles removed.');
}
