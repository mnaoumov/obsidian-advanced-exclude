import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { IndexProjectionComponent } from '../index-projection-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from '../plugin-settings.ts';
import { AdapterPatchBaseComponent } from './adapter-patch-base-component.ts';

interface CreateComponentOverrides {
  settings?: PluginSettings;
}

class TestAdapterPatchBaseComponent extends AdapterPatchBaseComponent {
  public callGenerateReconcileWrapper(
    originalFn: (normalizedPath: string, ...args: unknown[]) => Promise<void>,
    isFolder: boolean
  ): (normalizedPath: string, ...args: unknown[]) => Promise<void> {
    return this.generateReconcileWrapper(originalFn, isFolder);
  }
}

describe('AdapterPatchBaseComponent', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let indexProjectionComponent: IndexProjectionComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;
  let settings: PluginSettings;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();
  });

  function createComponent(overrides: CreateComponentOverrides = {}): TestAdapterPatchBaseComponent {
    const effectiveSettings = overrides.settings ?? settings;
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: vi.fn().mockReturnValue(false)
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: effectiveSettings
    });
    fileTreeComponent = strictProxy<FileTreeComponent>({
      deleteFromFilesPane: vi.fn()
    });
    indexProjectionComponent = strictProxy<IndexProjectionComponent>({
      recordCreate: vi.fn()
    });

    return new TestAdapterPatchBaseComponent({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });
  }

  describe('generateReconcileWrapper', () => {
    it('should call next when path is not ignored', async () => {
      const component = createComponent();
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, false);
      await wrapper('test/path');

      expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('test/path', false);
      expect(next).toHaveBeenCalledWith('test/path');
    });

    it('should return early when path is ignored and excludeMode is Full', async () => {
      settings.excludeMode = ExcludeMode.Full;
      const component = createComponent();
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, true);
      await wrapper('ignored/path');

      expect(next).not.toHaveBeenCalled();
      expect(vi.mocked(fileTreeComponent.deleteFromFilesPane)).not.toHaveBeenCalled();
    });

    it('should call next and deleteFromFilesPane when path is ignored and excludeMode is FilesPane', async () => {
      settings.excludeMode = ExcludeMode.FilesPane;
      const component = createComponent();
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, false);
      await wrapper('ignored/path');

      expect(next).toHaveBeenCalledWith('ignored/path');
      expect(vi.mocked(fileTreeComponent.deleteFromFilesPane)).toHaveBeenCalledWith('ignored/path');
    });

    it('should pass isFolder flag correctly for folders', async () => {
      const component = createComponent();
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, true);
      await wrapper('folder/path');

      expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('folder/path', true);
    });

    it('should forward additional arguments to next', async () => {
      const component = createComponent();
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, false);
      await wrapper('test/path', 'arg1', 'arg2');

      expect(next).toHaveBeenCalledWith('test/path', 'arg1', 'arg2');
    });

    it('should record the create in the shadow model', async () => {
      const component = createComponent();
      const next = vi.fn().mockResolvedValue(undefined);

      const wrapper = component.callGenerateReconcileWrapper(next, true);
      await wrapper('some/folder');

      expect(vi.mocked(indexProjectionComponent.recordCreate)).toHaveBeenCalledWith('some/folder', true);
    });
  });
});
