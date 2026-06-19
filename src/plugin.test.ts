import type {
  Component,
  PluginManifest
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponentConstructorParams } from './ignore-patterns-component.ts';

import { Plugin } from './plugin.ts';

vi.mock('obsidian-dev-utils/obsidian/data-handler', () => ({
  PluginDataHandler: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-tab-component', () => ({
  PluginSettingsTabComponent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin', () => {
  class MockPluginBase {
    public app: App;
    public consoleDebugComponent = {};
    public manifest: PluginManifest;

    private readonly children: unknown[] = [];

    public constructor(app: App, manifest: PluginManifest) {
      this.app = app;
      this.manifest = manifest;
    }

    public addChild<T>(child: T): T {
      this.children.push(child);
      return child;
    }

    public async onload(): Promise<void> {
      await this.onloadImpl();
    }

    protected onloadImpl(): Promise<void> {
      return noopAsync();
    }
  }

  return { PluginBase: MockPluginBase };
});

const mockUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('./file-tree-component.ts', () => {
  return {
    // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`
    FileTreeComponent: vi.fn().mockImplementation(function () {
      return { update: mockUpdate };
    })
  };
});

let capturedOnUpdateFileTree: (() => Promise<void>) | undefined;
vi.mock('./ignore-patterns-component.ts', () => {
  return {
    // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`
    IgnorePatternsComponent: vi.fn().mockImplementation(function (params: IgnorePatternsComponentConstructorParams) {
      capturedOnUpdateFileTree = params.onUpdateFileTree;
    })
  };
});

vi.mock('./patches/adapter-patch.ts', () => ({
  AdapterPatch: vi.fn()
}));

vi.mock('./patches/file-explorer-view-on-create-patch.ts', () => ({
  FileExplorerViewOnCreatePatch: vi.fn()
}));

vi.mock('./patches/vault-load-patch.ts', () => ({
  VaultLoadPatch: vi.fn()
}));

vi.mock('./plugin-settings-component.ts', () => ({
  PluginSettingsComponent: vi.fn()
}));

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./restore-notice-component.ts', () => ({
  RestoreNoticeComponent: vi.fn()
}));

function resetCapturedOnUpdateFileTree(): void {
  capturedOnUpdateFileTree = undefined;
}

describe('Plugin', () => {
  let app: App;
  let manifest: PluginManifest;

  beforeEach(() => {
    app = App.createConfigured__();
    manifest = {
      author: 'test',
      description: 'test',
      id: 'test-plugin',
      minAppVersion: '0.0.0',
      name: 'Test Plugin',
      version: '1.0.0'
    };
  });

  it('should create plugin and add all children via addChild', async () => {
    const appOriginal = app.asOriginalType__();
    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(plugin).toBeInstanceOf(Plugin);
    expect(plugin.app).toBe(appOriginal);
    expect(plugin.manifest).toBe(manifest);
  });

  it('should call addChild the expected number of times', async () => {
    const EXPECTED_ADD_CHILD_CALLS = 10;
    let addChildCallCount = 0;
    const appOriginal = app.asOriginalType__();

    // Patch addChild to count calls
    vi.spyOn(Plugin.prototype, 'addChild').mockImplementation(<T extends Component>(child: T): T => {
      addChildCallCount++;
      return child;
    });

    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(addChildCallCount).toBe(EXPECTED_ADD_CHILD_CALLS);

    vi.mocked(Plugin.prototype.addChild).mockRestore();
  });

  it('should wire onUpdateFileTree callback to fileTreeComponent.update', async () => {
    resetCapturedOnUpdateFileTree();
    mockUpdate.mockClear();

    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    expect(capturedOnUpdateFileTree).toBeDefined();
    // Invoke the callback — it should call fileTreeComponent.update()
    if (capturedOnUpdateFileTree) {
      capturedOnUpdateFileTree().catch(() => undefined);
    }
    expect(mockUpdate).toHaveBeenCalled();
  });
});
