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
  afterEach,
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

// Return-value stub of a dev-utils utility — the test controls what counts as a folder.
vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  isFolder: vi.fn().mockReturnValue(false)
}));

describe('FileExplorerViewOnCreatePatchComponent', () => {
  let app: App;
  let settings: PluginSettings;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let triggerWorkspaceLayoutReady: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    app = App.createConfigured__();
    triggerWorkspaceLayoutReady = undefined;
    app.asOriginalType__().workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
    app.asOriginalType__().workspace.onLayoutReady = vi.fn((callback: () => void) => {
      triggerWorkspaceLayoutReady = callback;
    });
    settings = new PluginSettings();

    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: vi.fn().mockReturnValue(false)
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createComponent(): FileExplorerViewOnCreatePatchComponent {
    return new FileExplorerViewOnCreatePatchComponent({
      app: app.asOriginalType__(),
      ignorePatternsComponent,
      pluginSettingsComponent
    });
  }

  /*
   * Drives the real layout-ready lifecycle: `load()` eager-loads the real
   * `CallbackLayoutReadyComponent` child (which registers `workspace.onLayoutReady`);
   * firing that callback and flushing the `setTimeout(…, 0)` runs the component's
   * real `onLayoutReady`. `invokeAsyncSafely` calls its function synchronously, so
   * the patch is registered by the time `runAllTimers` returns.
   */
  function loadAndFireLayoutReady(component: FileExplorerViewOnCreatePatchComponent): void {
    component.load();
    triggerWorkspaceLayoutReady?.();
    vi.runAllTimers();
  }

  function useFileExplorerView(view: View): void {
    vi.mocked(app.asOriginalType__().workspace.getLeavesOfType).mockReturnValue(
      castTo<ReturnType<Workspace['getLeavesOfType']>>([strictProxy<WorkspaceLeaf>({ view })])
    );
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
      const component = createComponent();
      const registerMethodPatchSpy = vi.spyOn(component, 'registerMethodPatch');

      loadAndFireLayoutReady(component);

      expect(registerMethodPatchSpy).not.toHaveBeenCalled();
    });

    it('should register onCreate patch when file explorer view exists', () => {
      useFileExplorerView(new MockFileExplorerView(WorkspaceLeaf.create2__(app).asOriginalType3__()));

      const component = createComponent();
      const registerMethodPatchSpy = vi.spyOn(component, 'registerMethodPatch');

      loadAndFireLayoutReady(component);

      expect(registerMethodPatchSpy).toHaveBeenCalledOnce();
    });
  });

  describe('onCreate', () => {
    function setupOnCreateTest(): MockFileExplorerView {
      const mockView = new MockFileExplorerView(WorkspaceLeaf.create2__(app).asOriginalType3__());
      useFileExplorerView(mockView);
      return mockView;
    }

    it('should call next when excludeMode is not FilesPane', () => {
      settings.excludeMode = ExcludeMode.Full;

      const mockView = setupOnCreateTest();
      const onCreateSpy = vi.spyOn(MockFileExplorerView.prototype, 'onCreate');

      const component = createComponent();
      loadAndFireLayoutReady(component);

      const file = strictProxy<TAbstractFile>({ path: 'test/file.md' });
      mockView.onCreate(file);

      // In non-FilesPane mode, the original next should be called.
      expect(onCreateSpy).toHaveBeenCalledWith(file);
      onCreateSpy.mockRestore();
    });

    it('should call next when file is not ignored in FilesPane mode', () => {
      settings.excludeMode = ExcludeMode.FilesPane;
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(false);

      const mockView = setupOnCreateTest();
      const onCreateSpy = vi.spyOn(MockFileExplorerView.prototype, 'onCreate');

      const component = createComponent();
      loadAndFireLayoutReady(component);

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
      loadAndFireLayoutReady(component);

      const file = strictProxy<TAbstractFile>({ path: 'ignored/file.md' });
      mockView.onCreate(file);

      // Original onCreate should NOT be called when file is ignored.
      expect(onCreateSpy).not.toHaveBeenCalled();
      onCreateSpy.mockRestore();
    });
  });
});
