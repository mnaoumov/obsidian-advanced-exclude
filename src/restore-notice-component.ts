import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { invokeAsyncSafelyAfterDelay } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { IndexProjectionComponent } from './index-projection-component.ts';

/**
 * Above this many hidden paths, restoring inline would re-scan large folders
 * (e.g. `node_modules`) from disk, so we prompt for a reload instead — which
 * uses Obsidian's optimized, worker-based re-scan.
 */
const MAX_INLINE_RESTORE_PATH_COUNT = 1000;

export interface RestoreNoticeComponentConstructorParams {
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

    const hiddenCount = this.indexProjectionComponent.getHiddenCount();
    if (hiddenCount === 0) {
      return;
    }

    if (hiddenCount <= MAX_INLINE_RESTORE_PATH_COUNT) {
      // Deferred so the adapter patches are removed first, otherwise the restore would be re-filtered and hidden again.
      invokeAsyncSafelyAfterDelay(() => this.indexProjectionComponent.restoreAll());
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
