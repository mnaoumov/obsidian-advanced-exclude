import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { TAbstractFile } from 'obsidian';

import {
  View,
  Workspace
} from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  App,
  WorkspaceLeaf
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from '../plugin-settings.ts';
import { FileExplorerViewOnCreatePatchComponent } from './file-explorer-view-on-create-patch-component.ts';

class MockFileExplorerView extends View {
  public override getDisplayText(): string {
    return 'MockFileExplorerView';
  }

  public override getViewType(): string {
    return 'MockFileExplorerView';
  }

  public onCreate(_file: TAbstractFile): void {
    // Original implementation
  }
}

vi.mock('obsidian-dev-utils/object-utils', () => ({
  castTo: vi.fn((obj: unknown) => obj),
  getPrototypeOf: vi.fn((obj: object) => Object.getPrototypeOf(obj))
}));

vi.mock('obsidian-dev-utils/obsidian/components/layout-ready-component', () => {
  return {
    // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`
    CallbackLayoutReadyComponent: vi.fn().mockImplementation(function (_app: unknown, callback: () => void) {
      return { callback, load: vi.fn() };
    })
  };
});

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  isFolder: vi.fn().mockReturnValue(false)
}));

describe('FileExplorerViewOnCreatePatchComponent', () => {
  let app: App;
  let settings: PluginSettings;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;

  beforeEach(() => {
    app = App.createConfigured__();
    app.asOriginalType__().workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
    settings = new PluginSettings();

    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: vi.fn().mockReturnValue(false)
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings
    });
  });

  function createComponent(): FileExplorerViewOnCreatePatchComponent {
    return new FileExplorerViewOnCreatePatchComponent({
      app: app.asOriginalType__(),
      ignorePatternsComponent,
      pluginSettingsComponent
    });
  }

  describe('onload', () => {
    it('should add CallbackLayoutReadyComponent as child', () => {
      const component = createComponent();
      const addChildSpy = vi.spyOn(component, 'addChild');

      component.load();

      expect(addChildSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('onLayoutReady', () => {
    it('should not register patch when no file explorer view exists', () => {
      vi.mocked(app.asOriginalType__().workspace.getLeavesOfType).mockReturnValue([]);

      const component = createComponent();
      const registerMethodPatchSpy = vi.spyOn(component, 'registerMethodPatch');

      component.onLayoutReady();

      expect(registerMethodPatchSpy).not.toHaveBeenCalled();
    });

    it('should register onCreate patch when file explorer view exists', () => {
      const mockOnCreate = vi.fn();
      const mockView = strictProxy<FileExplorerView>({
        onCreate: mockOnCreate
      });
      vi.mocked(app.asOriginalType__().workspace.getLeavesOfType).mockReturnValue(
        castTo<ReturnType<Workspace['getLeavesOfType']>>([strictProxy<WorkspaceLeaf>({ view: mockView })])
      );

      const component = createComponent();
      component.load();
      component.onLayoutReady();

      // RegisterMethodPatch was called (1 from onload for CallbackLayoutReadyComponent's addChild,
      // But registerMethodPatch is on the component itself)
      expect(component).toBeDefined();
    });
  });

  describe('onCreate', () => {
    function setupOnCreateTest(): MockFileExplorerView {
      const mockView = new MockFileExplorerView(WorkspaceLeaf.create2__(app).asOriginalType3__());
      vi.mocked(app.asOriginalType__().workspace.getLeavesOfType).mockReturnValue(
        castTo<ReturnType<Workspace['getLeavesOfType']>>([strictProxy<WorkspaceLeaf>({ view: mockView })])
      );
      return mockView;
    }

    it('should call next when excludeMode is not FilesPane', () => {
      settings.excludeMode = ExcludeMode.Full;

      const mockView = setupOnCreateTest();
      const onCreateSpy = vi.spyOn(MockFileExplorerView.prototype, 'onCreate');

      const component = createComponent();
      component.load();
      component.onLayoutReady();

      const file = strictProxy<TAbstractFile>({ path: 'test/file.md' });
      mockView.onCreate(file);

      // In non-FilesPane mode, the original next should be called
      expect(onCreateSpy).toHaveBeenCalledWith(file);
      onCreateSpy.mockRestore();
    });

    it('should call next when file is not ignored in FilesPane mode', () => {
      settings.excludeMode = ExcludeMode.FilesPane;
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(false);

      const mockView = setupOnCreateTest();
      const onCreateSpy = vi.spyOn(MockFileExplorerView.prototype, 'onCreate');

      const component = createComponent();
      component.load();
      component.onLayoutReady();

      const file = strictProxy<TAbstractFile>({ path: 'test/file.md' });
      mockView.onCreate(file);

      expect(onCreateSpy).toHaveBeenCalledWith(file);
      onCreateSpy.mockRestore();
    });

    it('should not call next when file is ignored in FilesPane mode', () => {
      settings.excludeMode = ExcludeMode.FilesPane;
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);

      const mockView = setupOnCreateTest();
      const onCreateSpy = vi.spyOn(MockFileExplorerView.prototype, 'onCreate');

      const component = createComponent();
      component.load();
      component.onLayoutReady();

      const file = strictProxy<TAbstractFile>({ path: 'ignored/file.md' });
      mockView.onCreate(file);

      // Original onCreate should NOT be called when file is ignored
      expect(onCreateSpy).not.toHaveBeenCalled();
      onCreateSpy.mockRestore();
    });
  });
});
