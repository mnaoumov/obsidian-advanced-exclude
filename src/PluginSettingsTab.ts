import { Setting } from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';

import type { PluginTypes } from './PluginTypes.ts';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE
} from './IgnorePatternsComponent.ts';
import { ExcludeMode } from './PluginSettings.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
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
        this.bind(textArea, 'obsidianIgnoreContent');
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
          const manageButtonCaption = window.i18next.t('interface.button-manage');
          Array.from(tab.containerEl.querySelectorAll('button'))
            .find((tabButton) => tabButton.textContent === manageButtonCaption)
            ?.click();
        });
      });

    new Setting(this.containerEl)
      .setName('Exclude mode')
      .setDesc(createFragment((f) => {
        f.appendText('How to exclude files and folders.');
        f.createEl('br');
        appendCodeBlock(f, 'Full');
        f.appendText(' - Exclude files and folders from the entire Obsidian app, including the Files Pane, Backlinks, Graph, etc.');
        f.createEl('br');
        appendCodeBlock(f, 'Files Pane');
        f.appendText(' - Exclude files and folders from the Files Pane only.');
      }))
      .addDropdown((dropdown) => {
        dropdown.addOption(ExcludeMode.Full, 'Full');
        dropdown.addOption(ExcludeMode.FilesPane, 'Files Pane');
        this.bind(dropdown, 'excludeMode');
      });
  }

  public override async hideAsync(): Promise<void> {
    await super.hideAsync();
    await this.plugin.processConfigChanges();
  }
}
