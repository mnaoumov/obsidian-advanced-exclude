import type { SettingDefinitionItem } from 'obsidian';
import type { PluginSettingsTabBaseConstructorParams } from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

import {
  requireApiVersion,
  Setting
} from 'obsidian';
import { convertAsyncToSync } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import {
  PluginSettingsTabBase,
  SAVE_TO_FILE_CONTEXT
} from 'obsidian-dev-utils/obsidian/plugin/plugin-settings-tab';

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

  public override getControlValue(key: string): unknown {
    const settings = this.pluginSettingsComponent.settingsState.inputValues;
    if (!(key in settings)) {
      return undefined;
    }

    return settings[castTo<keyof PluginSettings>(key)];
  }

  public override getSettingDefinitions(): SettingDefinitionItem<keyof PluginSettings>[] {
    if (!requireApiVersion('1.13.0')) {
      return [];
    }

    return [
      {
        desc: createFragment((f) => {
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
        }),
        name: 'Ignore patterns',
        render: (setting): void => {
          setting
            .addTextArea((textArea) => {
              textArea
                .setPlaceholder('foo/bar/*\n!foo/bar/baz.md')
                .setValue(this.pluginSettingsComponent.settingsState.inputValues.obsidianIgnoreContent)
                .onChange(convertAsyncToSync((value) => this.setControlValue('obsidianIgnoreContent', value)));
              textArea.inputEl.addClass('ignore-patterns-control');
            })
            .addButton((button) => {
              button
                .setButtonText('Apply')
                .setCta()
                .onClick(convertAsyncToSync(() => this.ignorePatternsComponent.processConfigChanges()));
            });
        }
      },
      {
        control: {
          key: 'shouldIncludeGitIgnorePatterns',
          type: 'toggle'
        },
        desc: createFragment((f) => {
          f.appendText('Whether to include patterns from ');
          appendCodeBlock(f, GIT_IGNORE_FILE);
          f.appendText(' file.');
        }),
        name: `Include ${GIT_IGNORE_FILE} patterns`
      },
      {
        desc: createFragment((f) => {
          f.appendText('Whether to ignore files that are excluded by ');
          appendCodeBlock(f, 'File links > Excluded files');
          f.appendText(' setting.');
        }),
        name: 'Ignore excluded files',
        render: (setting): void => {
          setting
            .addToggle((toggle) => {
              toggle
                .setValue(this.pluginSettingsComponent.settingsState.inputValues.shouldIgnoreExcludedFiles)
                .onChange(convertAsyncToSync((value) => this.setControlValue('shouldIgnoreExcludedFiles', value)));
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
        }
      },
      {
        control: {
          key: 'excludeMode',
          options: {
            [ExcludeMode.FilesPane]: 'Files pane',
            [ExcludeMode.Full]: 'Full'
          },
          type: 'dropdown'
        },
        desc: createFragment((f) => {
          f.appendText('How to exclude files and folders.');
          f.createEl('br');
          appendCodeBlock(f, 'Full');
          f.appendText(' - Exclude files and folders from the entire Obsidian app, including the Files Pane, Backlinks, Graph, etc.');
          f.createEl('br');
          appendCodeBlock(f, 'Files Pane');
          f.appendText(' - Exclude files and folders from the Files Pane only.');
        }),
        name: 'Exclude mode'
      }
    ];
  }

  public override async hideAsync(): Promise<void> {
    await super.hideAsync();
    await this.ignorePatternsComponent.processConfigChanges();
  }

  public override async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.pluginSettingsComponent.settingsState.inputValues;
    if (!(key in settings)) {
      return;
    }

    const propertyName = castTo<keyof PluginSettings>(key);
    await this.pluginSettingsComponent.setProperty(propertyName, castTo<PluginSettings[typeof propertyName]>(value));
    await this.pluginSettingsComponent.saveToFile(SAVE_TO_FILE_CONTEXT);
  }
}
