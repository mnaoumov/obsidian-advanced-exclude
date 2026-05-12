import {
  describe,
  expect,
  it
} from 'vitest';

import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

describe('ExcludeMode', () => {
  it('should have Full mode', () => {
    expect(ExcludeMode.Full).toBe('Full');
  });

  it('should have FilesPane mode', () => {
    expect(ExcludeMode.FilesPane).toBe('FilesPane');
  });
});

describe('PluginSettings', () => {
  it('should have correct default values', () => {
    const settings = new PluginSettings();
    expect(settings.excludeMode).toBe(ExcludeMode.Full);
    expect(settings.obsidianIgnoreContent).toBe('');
    expect(settings.shouldIgnoreExcludedFiles).toBe(false);
    expect(settings.shouldIncludeGitIgnorePatterns).toBe(true);
  });
});
