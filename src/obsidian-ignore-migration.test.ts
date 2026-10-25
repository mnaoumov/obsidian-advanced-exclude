import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { App } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { readIfExists } from './data-adapter-safe.ts';
import {
  migrateObsidianIgnoreFile,
  OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY
} from './obsidian-ignore-migration.ts';
import { PluginSettings } from './plugin-settings.ts';

vi.mock('./data-adapter-safe.ts', () => ({
  readIfExists: vi.fn()
}));

interface RunMigrationParams {
  readonly fileContent: null | string;
  readonly isMigrated?: boolean;
  readonly settings?: Partial<PluginSettings>;
}

interface RunMigrationResult {
  readonly editAndSave: ReturnType<typeof vi.fn>;
  readonly saveLocalStorage: ReturnType<typeof vi.fn>;
  readonly settings: PluginSettings;
  readonly showNotice: ReturnType<typeof vi.fn>;
}

describe('migrateObsidianIgnoreFile', () => {
  it('should copy the file patterns into the settings when they differ, and say so', async () => {
    const { editAndSave, saveLocalStorage, settings, showNotice } = await runMigration({ fileContent: 'private/\n', settings: { obsidianIgnoreContent: 'old/' } });

    expect(editAndSave).toHaveBeenCalledOnce();
    expect(settings.obsidianIgnoreContent).toBe('private/\n');
    expect(saveLocalStorage).toHaveBeenCalledWith(OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY, true);
    expect(getNoticeText(showNotice)).toContain('were copied into them');
    expect(getNoticeText(showNotice)).toContain('Include .obsidianignore patterns');
  });

  it('should leave the settings alone when they already hold the file patterns, and still say the file is no longer read', async () => {
    const { editAndSave, showNotice } = await runMigration({ fileContent: 'private/\r\n', settings: { obsidianIgnoreContent: 'private/' } });

    expect(editAndSave).not.toHaveBeenCalled();
    expect(getNoticeText(showNotice)).not.toContain('were copied into them');
    expect(getNoticeText(showNotice)).toContain('is no longer read');
  });

  it('should only mark the device when there is no file, or an empty one', async () => {
    for (const fileContent of [null, ' \n']) {
      const { editAndSave, saveLocalStorage, showNotice } = await runMigration({ fileContent });

      expect(editAndSave).not.toHaveBeenCalled();
      expect(showNotice).not.toHaveBeenCalled();
      expect(saveLocalStorage).toHaveBeenCalledWith(OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY, true);
    }
  });

  it('should not read the file when the file source is already on', async () => {
    const { editAndSave, showNotice } = await runMigration({ fileContent: 'private/', settings: { shouldIncludeObsidianIgnorePatterns: true } });

    expect(readIfExists).not.toHaveBeenCalled();
    expect(editAndSave).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should run once per device', async () => {
    const { editAndSave, saveLocalStorage, showNotice } = await runMigration({ fileContent: 'private/', isMigrated: true });

    expect(readIfExists).not.toHaveBeenCalled();
    expect(editAndSave).not.toHaveBeenCalled();
    expect(saveLocalStorage).not.toHaveBeenCalled();
    expect(showNotice).not.toHaveBeenCalled();
  });
});

function getNoticeText(showNotice: ReturnType<typeof vi.fn>): string {
  const [fragment] = showNotice.mock.calls[0] as [DocumentFragment];
  return fragment.textContent;
}

async function runMigration(params: RunMigrationParams): Promise<RunMigrationResult> {
  vi.mocked(readIfExists).mockReset().mockResolvedValue(params.fileContent);
  const settings = Object.assign(new PluginSettings(), params.settings);
  const editAndSave = vi.fn(async (editor: (settings: PluginSettings) => Promise<void> | void) => {
    await editor(settings);
  });
  const saveLocalStorage = vi.fn();
  const showNotice = vi.fn();
  await migrateObsidianIgnoreFile({
    app: strictProxy<App>({
      loadLocalStorage: vi.fn((key: string) => key === OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY && params.isMigrated ? true : null),
      saveLocalStorage
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ editAndSave, settings })
  });
  return { editAndSave, saveLocalStorage, settings, showNotice };
}
