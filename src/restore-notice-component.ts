import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';

export interface RestoreNoticeComponentConstructorParams {
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

export class RestoreNoticeComponent extends ComponentEx {
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: RestoreNoticeComponentConstructorParams) {
    super();
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  public override onunload(): void {
    super.onunload();

    if (!this.ignorePatternsComponent.hasHiddenPaths) {
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
