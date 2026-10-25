import type {
  App,
  DropdownComponent
} from 'obsidian';

import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import {
  convertAsyncToSync,
  invokeAsyncSafely
} from '@mnaoumov/typescript-lib/async';
import {
  Modal,
  Setting
} from 'obsidian';

import type {
  PluginSettings,
  SettingsProfile
} from './plugin-settings.ts';
import type {
  ImportedFileContents,
  ResolveProfileSettings
} from './profiles.ts';

import { readIfExists } from './data-adapter-safe.ts';
import { ExcludeMode } from './plugin-settings.ts';
import {
  FILE_IMPORT_PREFIX,
  findProfileByName,
  isFileImportName,
  resolveProfile
} from './profiles.ts';

const INHERIT_VALUE = 'inherit';
const ON_VALUE = 'on';
const OFF_VALUE = 'off';
const EXCLUDE_MODE_BY_VALUE = new Map<string, ExcludeMode>([[ExcludeMode.FilesPane, ExcludeMode.FilesPane], [ExcludeMode.Full, ExcludeMode.Full]]);

type BooleanScalarName = 'shouldHideEmptyFolders' | 'shouldIgnoreExcludedFiles' | 'shouldIncludeGitIgnorePatterns';

interface ProfileEditModalConstructorParams {
  readonly app: App;
  /**
  The imported files' contents as the plugin last read them. A file the draft imports beyond these is read on demand.
  */
  readonly importedFileContents: ImportedFileContents;
  /**
  Called with the edited copy when the user saves. The modal never mutates {@link profile}.
  */
  readonly onSave: (this: void, profile: SettingsProfile) => Promise<void>;
  readonly profile: Readonly<SettingsProfile>;
  /**
  The base settings and every profile, with {@link profile} among them or not yet (a new one).
  */
  readonly settings: ResolveProfileSettings;
}

/**
 * Edits one profile: its name, its pattern text with `@import` / `@reset`, and which settings it overrides. Shows
 * the errors and the expansion it would produce live, as if it were the active profile.
 */
export class ProfileEditModal extends Modal {
  private readonly draft: SettingsProfile;
  // Created detached, so an input handler can always reach them; onOpen puts them in place.
  private readonly errorsEl = createDiv();
  private readonly expansionEl = createEl('pre', { cls: 'advanced-exclude-profile-expansion' });
  private readonly importedFileContents: Map<string, null | string>;
  private readonly nameErrorEl = createDiv({ cls: 'advanced-exclude-profile-error' });
  private readonly onSave: (profile: SettingsProfile) => Promise<void>;
  private readonly originalName: string;
  private readonly settings: ResolveProfileSettings;

  public constructor(params: ProfileEditModalConstructorParams) {
    super(params.app);
    this.draft = { ...params.profile };
    this.importedFileContents = new Map(params.importedFileContents);
    this.onSave = params.onSave;
    this.originalName = params.profile.name;
    this.settings = params.settings;
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  public override onOpen(): void {
    this.setTitle(`Edit profile: ${this.originalName}`);
    const { contentEl } = this;
    contentEl.addClass('advanced-exclude-profile-edit');

    new Setting(contentEl)
      .setName('Name')
      .setDesc('Other profiles import this one by its name.')
      .addText((text) => {
        text.setValue(this.draft.name).onChange((value) => {
          this.draft.name = value;
          this.validateName();
        });
      });
    contentEl.append(this.nameErrorEl);

    new Setting(contentEl)
      .setName('Patterns')
      .setDesc(createFragment((f) => {
        f.appendText('gitignore syntax, one pattern per line. ');
        appendCodeBlock(f, '@import <profile>');
        f.appendText(' inserts another profile\'s patterns at that line, ');
        appendCodeBlock(f, '@import file:<vault path>');
        f.appendText(' inserts a file\'s patterns, ');
        appendCodeBlock(f, '@reset');
        f.appendText(' drops everything collected before it, and ');
        appendCodeBlock(f, String.raw`\@`);
        f.appendText(' starts a pattern that begins with ');
        appendCodeBlock(f, '@');
        f.appendText('.');
      }))
      .addTextArea((textArea) => {
        textArea.inputEl.addClass('ignore-patterns-control');
        textArea.setPlaceholder('@import Base work\nprivate/\n!private/shared.md').setValue(this.draft.patterns).onChange((value) => {
          this.draft.patterns = value;
          this.renderResolution();
        });
      });

    new Setting(contentEl)
      .setName('Exclude mode')
      .addDropdown((dropdown) => {
        dropdown
          .addOption(INHERIT_VALUE, 'Inherit')
          .addOption(ExcludeMode.Full, 'Full')
          .addOption(ExcludeMode.FilesPane, 'Files pane')
          .setValue(this.draft.excludeMode ?? INHERIT_VALUE)
          .onChange((value) => {
            this.draft.excludeMode = EXCLUDE_MODE_BY_VALUE.get(value);
            this.renderResolution();
          });
      });
    this.addBooleanSetting('shouldIncludeGitIgnorePatterns', 'Include .gitignore patterns');
    this.addBooleanSetting('shouldIgnoreExcludedFiles', 'Ignore excluded files');
    this.addBooleanSetting('shouldHideEmptyFolders', 'Hide empty folders');

    contentEl.createEl('h4', { text: 'Errors' });
    contentEl.append(this.errorsEl);
    contentEl.createEl('h4', { text: 'Effective patterns when this profile is active' });
    contentEl.append(this.expansionEl);

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText('Cancel').onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText('Save').setCta().onClick(convertAsyncToSync(async () => {
          if (!this.validateName()) {
            return;
          }
          this.draft.name = this.draft.name.trim();
          this.close();
          await this.onSave({ ...this.draft });
        }));
      });

    this.validateName();
    this.renderResolution();
  }

  private addBooleanSetting(propertyName: BooleanScalarName, name: string): void {
    new Setting(this.contentEl)
      .setName(name)
      .addDropdown((dropdown: DropdownComponent) => {
        const value = this.draft[propertyName];
        dropdown
          .addOption(INHERIT_VALUE, 'Inherit')
          .addOption(ON_VALUE, 'On')
          .addOption(OFF_VALUE, 'Off')
          .setValue(value === undefined ? INHERIT_VALUE : (value ? ON_VALUE : OFF_VALUE))
          .onChange((newValue) => {
            this.draft[propertyName] = newValue === INHERIT_VALUE ? undefined : newValue === ON_VALUE;
            this.renderResolution();
          });
      });
  }

  /**
   * Reads files the draft imports that no one has read yet, then shows the expansion again with them.
   */
  private async readFiles(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      this.importedFileContents.set(path, await readIfExists(this.app, path));
    }
    this.renderResolution();
  }

  private renderResolution(): void {
    const { errorsEl, expansionEl } = this;
    const otherProfiles = this.settings.profiles.filter((profile) => profile.id !== this.draft.id);
    const effectiveSettings = resolveProfile({
      activeProfileId: this.draft.id,
      importedFileContents: this.importedFileContents,
      settings: { ...this.settings, profiles: [...otherProfiles, this.draft] }
    });
    const unreadPaths = effectiveSettings.importedFilePaths.filter((path) => !this.importedFileContents.has(path));
    if (unreadPaths.length > 0) {
      invokeAsyncSafely(() => this.readFiles(unreadPaths));
    }

    errorsEl.empty();
    if (effectiveSettings.errors.length === 0) {
      errorsEl.createDiv({ text: 'None.' });
    }
    for (const error of effectiveSettings.errors) {
      errorsEl.createDiv({
        cls: 'advanced-exclude-profile-error',
        text: `${error.profileName}, line ${String(error.lineNumber)}: ${error.message}`
      });
    }

    expansionEl.empty();
    for (const line of effectiveSettings.lines) {
      const lineEl = expansionEl.createDiv();
      const source = line.profileName ?? 'base';
      lineEl.createSpan({ cls: 'advanced-exclude-profile-source', text: `${line.filePath === undefined ? source : `${source} (${line.filePath})`}: ` });
      lineEl.appendText(line.text);
    }
    // Not an error: a missing file is a valid import of nothing, but the user may have mistyped its path.
    for (const path of effectiveSettings.importedFilePaths) {
      if (this.importedFileContents.get(path) === null) {
        expansionEl.createDiv({ cls: 'advanced-exclude-profile-source', text: `${path} (file not found, nothing imported)` });
      }
    }
    expansionEl.createDiv({ cls: 'advanced-exclude-profile-source', text: describeScalars(effectiveSettings) });
  }

  private validateName(): boolean {
    const name = this.draft.name.trim();
    const otherProfiles = this.settings.profiles.filter((profile) => profile.id !== this.draft.id);
    let message = '';
    if (name === '') {
      message = 'A profile needs a name.';
    } else if (isFileImportName(name)) {
      message = `A profile name cannot start with "${FILE_IMPORT_PREFIX}": that imports a file.`;
    } else if (findProfileByName(otherProfiles, name)) {
      message = `Another profile is already named "${name}".`;
    }
    this.nameErrorEl.setText(message);
    return message === '';
  }
}

function describeScalars(settings: Pick<PluginSettings, 'excludeMode' | BooleanScalarName>): string {
  return `Exclude mode: ${settings.excludeMode}; `
    + `.gitignore patterns: ${formatOnOff(settings.shouldIncludeGitIgnorePatterns)}; `
    + `ignore excluded files: ${formatOnOff(settings.shouldIgnoreExcludedFiles)}; hide empty folders: ${formatOnOff(settings.shouldHideEmptyFolders)}.`;
}

function formatOnOff(isOn: boolean): string {
  return isOn ? 'on' : 'off';
}
