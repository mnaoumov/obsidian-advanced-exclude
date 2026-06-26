import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import { Setting } from 'obsidian';
import { convertAsyncToSync } from 'obsidian-dev-utils/async';
import { appendCodeBlock } from 'obsidian-dev-utils/html-element';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE
} from './constants.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

interface PluginSettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly ignorePatternsComponent: IgnorePatternsComponent;
}

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  private readonly ignorePatternsComponent: IgnorePatternsComponent;

  public constructor(params: PluginSettingsTabConstructorParams) {
    super(params);
    this.ignorePatternsComponent = params.ignorePatternsComponent;
  }

  public override displayLegacy(): void {
    super.displayLegacy();

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
        this.bind({
          propertyName: 'obsidianIgnoreContent',
          valueComponent: textArea
        });
      })
      .addButton((button) => {
        button
          .setButtonText('Apply')
          .setCta()
          .onClick(convertAsyncToSync(async () => {
            await this.ignorePatternsComponent.processConfigChanges();
          }));
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
        this.bind({
          propertyName: 'shouldIncludeGitIgnorePatterns',
          valueComponent: toggle
        });
      });

    new Setting(this.containerEl)
      .setName('Ignore excluded files')
      .setDesc(createFragment((f) => {
        f.appendText('Whether to ignore files that are excluded by ');
        appendCodeBlock(f, 'File links > Excluded files');
        f.appendText(' setting.');
      }))
      .addToggle((toggle) => {
        this.bind({
          propertyName: 'shouldIgnoreExcludedFiles',
          valueComponent: toggle
        });
      })
      .addButton((button) => {
        button.setButtonText('Go to settings');
        /* v8 ignore start -- Deep Obsidian UI integration; covered by integration tests. */
        button.onClick(() => {
          const tab = this.app.setting.openTabById('file');
          const manageButtonCaption = window.i18next.t('interface.button-manage');
          Array.from(tab.containerEl.querySelectorAll('button'))
            .find((tabButton) => tabButton.textContent === manageButtonCaption)
            ?.click();
        });
        /* v8 ignore stop */
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
        dropdown.addOption(ExcludeMode.FilesPane, 'Files pane');
        this.bind({
          propertyName: 'excludeMode',
          valueComponent: dropdown
        });
      });
  }

  public override async hideAsync(): Promise<void> {
    await super.hideAsync();
    await this.ignorePatternsComponent.processConfigChanges();
  }
}
