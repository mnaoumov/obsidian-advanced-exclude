import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { Notice } from 'obsidian';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

/**
 * A persistent {@link Notice} carrying a `<progress>` bar, shown while the
 * projection updates the file tree.
 *
 * The update can take a few seconds on a large vault; this gives the user a
 * visible indicator (and, because the projection yields between chunks, a bar
 * that actually advances) instead of a silent UI freeze.
 */
export class UpdateProgressNoticeComponent extends ComponentEx {
  private notice: Notice | null = null;
  private progressEl: HTMLProgressElement | null = null;

  public constructor(private readonly pluginNoticeComponent: PluginNoticeComponent) {
    super();
  }

  /**
   * Hides the notice, if any.
   */
  public finish(): void {
    this.notice?.hide();
    this.notice = null;
    this.progressEl = null;
  }

  public override onunload(): void {
    this.finish();
    super.onunload();
  }

  /**
   * Updates the bar to `processed` of `total`. No-op if no notice is showing.
   */
  public report(processed: number, total: number): void {
    if (!this.progressEl) {
      return;
    }
    this.progressEl.max = total;
    this.progressEl.value = processed;
  }

  /**
   * Shows the notice with `message` and a fresh (indeterminate) progress bar,
   * replacing any notice already showing.
   */
  public start(message: string): void {
    this.finish();
    const fragment = createFragment((f) => {
      f.appendText(message);
      f.createEl('br');
      this.progressEl = f.createEl('progress');
    });
    this.notice = this.pluginNoticeComponent.showNotice(fragment, { isPermanent: true });
  }
}
