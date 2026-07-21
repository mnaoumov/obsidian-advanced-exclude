import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { IndexProjectionComponent } from './index-projection-component.ts';

interface RestoreNoticeComponentConstructorParams {
  readonly indexProjectionComponent: IndexProjectionComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

export class RestoreNoticeComponent extends ComponentEx {
  private readonly indexProjectionComponent: IndexProjectionComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: RestoreNoticeComponentConstructorParams) {
    super();
    this.indexProjectionComponent = params.indexProjectionComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  public override onunload(): void {
    super.onunload();

    // This component is added after `IndexProjectionComponent`, so it unloads FIRST
    // (children unload in reverse add order). That is exactly why the on-disable
    // Restore is driven from here — the projection is still loaded, so its in-memory
    // Snapshots are intact and the index can be restored synchronously. When the
    // Restore succeeds there is nothing to reload, so the notice is suppressed.
    if (this.indexProjectionComponent.restoreHiddenFilesOnUnload()) {
      return;
    }

    if (this.indexProjectionComponent.getHiddenCount() === 0) {
      return;
    }

    const fragment = createFragment((f) => {
      f.appendText('The file tree is not fully restored to the original state. You need to ');
      const reloadButton = f.createEl('button', { text: 'Reload' });
      reloadButton.addEventListener('click', () => {
        this.reloadApp();
      });
      f.appendText(' the app to restore the file tree. Alternatively, you can re-enable the plugin.');
    });

    // The library keeps a permanent notice alive past unload and dismisses it when the plugin is re-enabled.
    this.pluginNoticeComponent.showNotice(fragment, { isPermanent: true });
  }

  private reloadApp(): void {
    window.location.reload();
  }
}
