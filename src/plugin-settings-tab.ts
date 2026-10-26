import type { PluginSettingsTabBaseConstructorParams } from '@mnaoumov/obsidian-lib/plugin/plugin-settings-tab';
import type { SettingDefinitionItem } from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { confirm } from '@mnaoumov/obsidian-lib/modals/confirm';
import { PluginSettingsTabBase } from '@mnaoumov/obsidian-lib/plugin/plugin-settings-tab';
import {
  convertAsyncToSync,
  invokeAsyncSafely
} from '@mnaoumov/typescript-lib/async';
import { Setting } from 'obsidian';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type {
  PluginSettings,
  SettingsProfile
} from './plugin-settings.ts';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE
} from './constants.ts';
import { attachPatternValidation } from './pattern-findings-view.ts';
import { ExcludeMode } from './plugin-settings.ts';
import { ProfileEditModal } from './profile-edit-modal.ts';
import { getProfileChoices } from './profile-suggest-modal.ts';
import {
  createProfileId,
  createUniqueProfileName,
  duplicateProfile,
  saveProfile
} from './profiles.ts';

const README_URL = 'https://github.com/mnaoumov/obsidian-advanced-exclude';
const GITIGNORE_SYNTAX_URL = 'https://git-scm.com/docs/gitignore#_pattern_format';

// A dropdown value cannot be `null`, and a profile id never contains a space.
const BASE_SETTINGS_VALUE = 'base settings';

interface PluginSettingsTabConstructorParams extends PluginSettingsTabBaseConstructorParams<PluginSettings> {
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class PluginSettingsTab extends PluginSettingsTabBase<PluginSettings> {
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly profileSettingsComponent: PluginSettingsComponent;

  public constructor(params: PluginSettingsTabConstructorParams) {
    super(params);
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.profileSettingsComponent = params.pluginSettingsComponent;
  }

  public override async hideAsync(): Promise<void> {
    await super.hideAsync();
    await this.ignorePatternsComponent.processConfigChanges();
  }

  protected override getSettingDefinitionItems(): SettingDefinitionItem[] {
    return [
      this.settingGroupEx({
        heading: 'Every device: plugin settings, carried by Obsidian Sync',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Patterns to ignore files and folders on every device.');
              f.createEl('br');
              f.appendText('Each pattern should be on a new line.');
              f.createEl('br');
              f.appendText('Uses ');
              f.createEl('a', { href: GITIGNORE_SYNTAX_URL, text: 'gitignore' });
              f.appendText(' syntax.');
              f.createEl('br');
              f.appendText('See ');
              f.createEl('a', { href: `${README_URL}/blob/main/demo-vault/02%20Whitelist%20with%20negation.md`, text: 'Whitelist with negation' });
              f.appendText(' for how to whitelist only certain files.');
              f.createEl('br');
              f.appendText('The patterns are stored in the plugin settings, so Obsidian Sync carries them to your other devices.');
            }),
            name: 'Global patterns',
            render: (setting) => {
              setting
                .addTextArea((textArea) => {
                  textArea.setPlaceholder('foo/bar/*\n!foo/bar/baz.md');
                  textArea.inputEl.addClass('ignore-patterns-control');
                  this.bind({
                    propertyName: 'ignorePatterns',
                    valueComponent: textArea
                  });
                  addPatternFindings(setting, textArea.inputEl);
                });
              this.addApplyButton(setting);
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: `This device: ${OBSIDIAN_IGNORE_FILE}, not carried by Obsidian Sync`,
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Patterns to ignore files and folders on this device only, after the global patterns.');
              f.createEl('br');
              f.appendText('They live in the ');
              appendCodeBlock(f, OBSIDIAN_IGNORE_FILE);
              f.appendText(' file at the vault root. Obsidian Sync does not carry files whose name starts with a dot; git, Syncthing and other sync tools may.');
              f.createEl('br');
              f.appendText('The file is created the first time you edit this box. An edit made to it in another app shows here when you come back to Obsidian.');
            }),
            name: 'Local patterns',
            render: (setting) => {
              // The file may have changed with no event for it, a deletion included. A change re-renders the tab.
              invokeAsyncSafely(() => this.ignorePatternsComponent.refreshLocalPatterns());
              setting
                .addTextArea((textArea) => {
                  textArea.inputEl.addClass('ignore-patterns-control');
                  textArea
                    .setValue(this.ignorePatternsComponent.getLocalPatternsText())
                    .onChange((value: string) => {
                      // Written once the typing pauses; the tab's hide and Apply write a waiting text first.
                      this.ignorePatternsComponent.scheduleLocalPatternsSave(value);
                    });
                  addPatternFindings(setting, textArea.inputEl);
                });
              this.addApplyButton(setting);
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Options',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to include patterns from ');
              appendCodeBlock(f, GIT_IGNORE_FILE);
              f.appendText(' file.');
            }),
            name: `Include ${GIT_IGNORE_FILE} patterns.`,
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  propertyName: 'shouldIncludeGitIgnorePatterns',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to ignore files that are excluded by ');
              appendCodeBlock(f, 'File links > Excluded files');
              f.appendText(' setting.');
            }),
            name: 'Ignore excluded files',
            render: (setting) => {
              setting
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
                    [...tab.containerEl.querySelectorAll('button')]
                      .find((tabButton) => tabButton.textContent === manageButtonCaption)
                      ?.click();
                  });
                  /* v8 ignore stop */
                });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Whether to hide folders left empty because every file inside them is excluded.');
              f.createEl('br');
              f.appendText('Cascades to parent folders: when a folder and all of its subfolders become empty, the whole chain is hidden.');
              f.createEl('br');
              f.appendText('Genuinely empty folders (with no files at all) stay visible.');
            }),
            name: 'Hide empty folders',
            render: (setting) => {
              setting.addToggle((toggle) => {
                this.bind({
                  propertyName: 'shouldHideEmptyFolders',
                  valueComponent: toggle
                });
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('How to exclude files and folders.');
              f.createEl('br');
              appendCodeBlock(f, 'Full');
              f.appendText(' - Exclude files and folders from the entire Obsidian app, including the Files Pane, Backlinks, Graph, etc.');
              f.createEl('br');
              appendCodeBlock(f, 'Files Pane');
              f.appendText(' - Exclude files and folders from the Files Pane only.');
            }),
            name: 'Exclude mode',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                dropdown.addOption(ExcludeMode.Full, 'Full');
                dropdown.addOption(ExcludeMode.FilesPane, 'Files pane');
                this.bind({
                  propertyName: 'excludeMode',
                  valueComponent: dropdown
                });
              });
            }
          })
        ]
      }),
      this.settingGroupEx({
        heading: 'Profiles',
        items: [
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Which profile applies on this device. Each device keeps its own choice; the profiles themselves sync with the vault.');
              f.createEl('br');
              f.appendText('The global patterns and options above are the base settings, which apply when no profile is active and which a profile inherits. The local patterns apply whichever profile is active.');
            }),
            name: 'Active profile on this device',
            render: (setting) => {
              setting.addDropdown((dropdown) => {
                for (const choice of getProfileChoices(this.profileSettingsComponent)) {
                  dropdown.addOption(choice.id ?? BASE_SETTINGS_VALUE, choice.name);
                }
                dropdown
                  .setValue(this.profileSettingsComponent.effectiveSettings.activeProfile?.id ?? BASE_SETTINGS_VALUE)
                  .onChange(convertAsyncToSync(async (value: string) => {
                    await this.profileSettingsComponent.setActiveProfileId(value === BASE_SETTINGS_VALUE ? null : value);
                  }));
              });
            }
          }),
          this.settingEx({
            desc: createFragment((f) => {
              f.appendText('Named sets of patterns and settings to switch between. A profile can ');
              appendCodeBlock(f, '@import');
              f.appendText(' other profiles, and overrides only the settings it sets.');
              f.createEl('br');
              f.createEl('a', { href: `${README_URL}/blob/main/demo-vault/05%20Profiles.md`, text: 'How profiles work' });
            }),
            name: 'Profiles',
            render: (setting) => {
              setting.addButton((button) => {
                button.setButtonText('Add profile').onClick(() => {
                  this.openProfileEditor({
                    id: createProfileId(),
                    name: createUniqueProfileName(this.profileSettingsComponent.settings.profiles, 'New profile'),
                    patterns: ''
                  });
                });
              });
              const listEl = setting.settingEl.createDiv({ cls: 'advanced-exclude-profile-list' });
              for (const profile of this.profileSettingsComponent.settings.profiles) {
                new Setting(listEl)
                  .setName(profile.name)
                  .addButton((button) => {
                    button.setButtonText('Edit').onClick(() => {
                      this.openProfileEditor(profile);
                    });
                  })
                  .addButton((button) => {
                    button.setButtonText('Duplicate').onClick(convertAsyncToSync(async () => {
                      await this.saveProfiles(duplicateProfile(this.profileSettingsComponent.settings.profiles, profile.id));
                    }));
                  })
                  .addButton((button) => {
                    button.setButtonText('Delete').setDestructive().onClick(convertAsyncToSync(async () => {
                      await this.deleteProfile(profile);
                    }));
                  });
              }
            }
          })
        ]
      })
    ];
  }

  private addApplyButton(setting: Setting): void {
    setting.addButton((button) => {
      button
        .setButtonText('Apply')
        .setCta()
        .onClick(convertAsyncToSync(async () => {
          await this.ignorePatternsComponent.processConfigChanges();
        }));
    });
  }

  private async deleteProfile(profile: Readonly<SettingsProfile>): Promise<void> {
    const isConfirmed = await confirm({
      app: this.app,
      message: `Delete the profile "${profile.name}"? Profiles that import it will report an unknown profile.`,
      okButtonText: 'Delete',
      title: 'Delete profile'
    });
    if (!isConfirmed) {
      return;
    }
    if (this.profileSettingsComponent.activeProfileId === profile.id) {
      await this.profileSettingsComponent.setActiveProfileId(null);
    }
    await this.saveProfiles(this.profileSettingsComponent.settings.profiles.filter((candidate) => candidate.id !== profile.id));
  }

  private openProfileEditor(profile: Readonly<SettingsProfile>): void {
    new ProfileEditModal({
      app: this.app,
      importedFileContents: this.profileSettingsComponent.importedFileContents,
      onSave: async (editedProfile): Promise<void> => {
        await this.saveProfiles(saveProfile(this.profileSettingsComponent.settings.profiles, editedProfile));
      },
      profile,
      settings: this.profileSettingsComponent.settings
    }).open();
  }

  /**
   * Saves a new profile list and re-renders the tab. The list is always a fresh array: the effective settings are
   * memoized on its reference.
   */
  private async saveProfiles(profiles: SettingsProfile[]): Promise<void> {
    await this.profileSettingsComponent.editAndSave((settings) => {
      settings.profiles = profiles;
    });
    this.refresh();
  }
}

/**
 * Shows the findings of the setting's pattern box under it, live. The global and local patterns are taken literally,
 * so no directive is allowed in them.
 */
function addPatternFindings(setting: Setting, textAreaEl: HTMLTextAreaElement): void {
  setting.controlEl.addClass('advanced-exclude-pattern-control');
  attachPatternValidation({
    areDirectivesAllowed: false,
    findingsEl: setting.controlEl.createDiv({ cls: 'advanced-exclude-pattern-findings' }),
    textAreaEl
  });
}
