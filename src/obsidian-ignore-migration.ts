import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { App } from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { OBSIDIAN_IGNORE_FILE } from './constants.ts';
import { readIfExists } from './data-adapter-safe.ts';

/**
 * The `app.loadLocalStorage` key marking that this device has run {@link migrateObsidianIgnoreFile}. It is per
 * device on purpose: each device had its own `.obsidianignore`, because Obsidian Sync never carries a dot file, so
 * each one checks its own once.
 */
export const OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY = 'advanced-exclude:obsidianignore-migrated';

interface MigrateObsidianIgnoreFileParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Moves the patterns of an existing `.obsidianignore` into the settings, once per device.
 *
 * The patterns used to live in that file, and Obsidian Sync skips every dot file, so a synced vault got them on one
 * device only. They now live in `data.json`, which syncs, and the file is read only when
 * `shouldIncludeObsidianIgnorePatterns` is on. The file was what applied on this device, so its patterns replace the
 * stored ones when the two differ. The file itself is left in place, and a notice says what happened.
 */
export async function migrateObsidianIgnoreFile(params: MigrateObsidianIgnoreFileParams): Promise<void> {
  const { app, pluginNoticeComponent, pluginSettingsComponent } = params;
  if (app.loadLocalStorage(OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY)) {
    return;
  }

  const content = pluginSettingsComponent.settings.shouldIncludeObsidianIgnorePatterns ? null : await readIfExists(app, OBSIDIAN_IGNORE_FILE);
  app.saveLocalStorage(OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY, true);
  if (content === null || content.trim() === '') {
    return;
  }

  const isImported = normalizePatterns(content) !== normalizePatterns(pluginSettingsComponent.settings.obsidianIgnoreContent);
  if (isImported) {
    await pluginSettingsComponent.editAndSave((settings) => {
      settings.obsidianIgnoreContent = content;
    });
  }

  // Stays until it is closed: it explains why the file stopped applying, so it must not slip by.
  pluginNoticeComponent.showNotice(
    createFragment((f) => {
      f.appendText('Ignore patterns now live in the plugin settings, so Obsidian Sync carries them to your other devices. ');
      if (isImported) {
        f.appendText('The patterns of ');
        appendCodeBlock(f, OBSIDIAN_IGNORE_FILE);
        f.appendText(' were copied into them. ');
      }
      appendCodeBlock(f, OBSIDIAN_IGNORE_FILE);
      f.appendText(' is no longer read. To keep reading it too, turn on ');
      appendCodeBlock(f, `Include ${OBSIDIAN_IGNORE_FILE} patterns`);
      f.appendText(' in the settings.');
    }),
    { shouldHideOnClick: false }
  );
}

function normalizePatterns(patterns: string): string {
  return patterns.replaceAll('\r\n', '\n').trimEnd();
}
