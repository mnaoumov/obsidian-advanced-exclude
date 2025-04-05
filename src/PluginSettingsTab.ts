import { Setting } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';

import type { Plugin } from './Plugin.ts';

import {
  getIgnorePatternsStr,
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE,
  setIgnorePatternsStr
} from './IgnorePatterns.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<Plugin> {
  private ignorePatternsStr = '';
  private isIgnorePatternsStrChanged = false;

  public override display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName('Ignore patterns')
      .setDesc(createFragment((f) => {
        f.appendText('Patterns to ignore files and folders.');
        f.createEl('br');
        f.appendText('Each pattern should be on a new line.');
        f.createEl('br');
        f.appendText('Uses ');
        f.createEl('a', { href: 'https://git-scm.com/docs/gitignore#_pattern_format', text: 'gitignore' });
        f.appendText(' syntax.');
        f.createEl('br');
        f.appendText('You can also edit ');
        appendCodeBlock(f, OBSIDIAN_IGNORE_FILE);
        f.appendText(' file manually.');
      }))
      .addTextArea((textArea) => {
        textArea.setPlaceholder('foo/bar/*\n!foo/bar/baz.md');
        textArea.inputEl.addClass('ignore-patterns-control');
        textArea.setDisabled(true);
        invokeAsyncSafely(async () => {
          const previousIgnorePatternsStr = await getIgnorePatternsStr(this.plugin);

          textArea.onChange((value) => {
            this.ignorePatternsStr = value;
            this.isIgnorePatternsStrChanged = value !== previousIgnorePatternsStr;
          });

          textArea.setValue(previousIgnorePatternsStr);
          textArea.setDisabled(false);
        });
      });

    new Setting(this.containerEl)
      .setName(createFragment((f) => {
        f.appendText('Include ');
        appendCodeBlock(f, GIT_IGNORE_FILE);
        f.appendText(' patterns.');
      }))
      .setDesc(createFragment((f) => {
        f.appendText('Whether to include patterns from ');
        appendCodeBlock(f, GIT_IGNORE_FILE);
        f.appendText(' file.');
      }))
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldIncludeGitIgnorePatterns');
      });

    new Setting(this.containerEl)
      .setName('Ignore Excluded Files')
      .setDesc(createFragment((f) => {
        f.appendText('Whether to ignore files that are excluded by ');
        appendCodeBlock(f, 'File links > Excluded files');
        f.appendText(' setting.');
      }))
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldIgnoreExcludedFiles');
      })
      .addButton((button) => {
        button.setButtonText('Go to settings');
        button.onClick(() => {
          const tab = this.app.setting.openTabById('file');
          const manageButtonCaption = i18next.t('interface.button-manage');
          Array.from(tab.containerEl.querySelectorAll('button'))
            .find((tabButton) => tabButton.textContent === manageButtonCaption)
            ?.click();
        });
      });
  }

  public override hide(): void {
    super.hide();
    if (this.isIgnorePatternsStrChanged) {
      invokeAsyncSafely(() => setIgnorePatternsStr(this.app, this.ignorePatternsStr));
    }
  }
}
