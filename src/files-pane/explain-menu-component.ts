import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  Menu,
  TAbstractFile
} from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';

import type { PathExplainer } from '../explain/path-explainer.ts';

import { renderPathExplanation } from '../explain/path-explanation.ts';

interface ExplainMenuComponentConstructorParams {
  readonly app: App;
  readonly pathExplainer: PathExplainer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

/**
 * Adds `Why is this excluded?` to the Files pane menu of one file or folder. It shows which line of which layer decides
 * the item's verdict, and which lines that line overrode. An item hidden in the `Full` mode is not in the Files pane, so
 * the settings tab's `Explain a path` box covers it.
 */
export class ExplainMenuComponent extends ComponentEx {
  private readonly app: App;
  private readonly pathExplainer: PathExplainer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: ExplainMenuComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pathExplainer = params.pathExplainer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  public override onload(): void {
    super.onload();
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      this.addMenuItem(menu, file);
    }));
  }

  /**
   * Shows the explanation for {@link file} in a notice.
   */
  public showExplanation(file: TAbstractFile): void {
    const explanation = this.pathExplainer.explain(file.path, isFolder(file));
    this.pluginNoticeComponent.showNotice(createFragment((f) => {
      renderPathExplanation(f.createDiv({ cls: 'advanced-exclude-explanation' }), explanation);
    }));
  }

  private addMenuItem(menu: Menu, file: TAbstractFile): void {
    // The vault root is never excluded.
    if (file.parent === null) {
      return;
    }
    menu.addItem((item) => {
      item
        .setTitle('Why is this excluded?')
        .setIcon('help-circle')
        .setSection('action')
        .onClick(() => {
          this.showExplanation(file);
        });
    });
  }
}
