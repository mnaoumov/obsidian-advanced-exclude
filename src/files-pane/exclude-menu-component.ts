import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  Menu,
  TAbstractFile
} from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { ExcludeMenuTarget } from './exclude-menu-patterns.ts';

import { OBSIDIAN_IGNORE_FILE } from '../constants.ts';
import { ExcludeMenuLayer } from '../settings/plugin-settings.ts';
import {
  appendPatternLines,
  createExcludeEverythingElseLines,
  createExcludeLine
} from './exclude-menu-patterns.ts';

export interface ExcludeMenuComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface ExcludeMenuComponentShowResultParams extends ExcludeMenuComponentWriteLinesParams {
  readonly addedLines: readonly string[];
  readonly layer: ExcludeMenuLayer;
}

interface ExcludeMenuComponentWriteLinesParams {
  readonly lines: readonly string[];
  /**
   * Whether each target should end up excluded (`Exclude`) or shown (`Exclude everything else in this folder`).
   */
  readonly shouldTargetsBeIgnored: boolean;
  readonly targets: readonly ExcludeMenuTarget[];
}

/**
 * Adds `Exclude` and `Exclude everything else in this folder` to the Files pane menu of a file or folder, and of a
 * multiple selection. Each writes `gitignore` lines to the layer the `Files pane menu writes to` setting names, and
 * applies them as a typed line is applied.
 */
export class ExcludeMenuComponent extends ComponentEx {
  private readonly app: App;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ExcludeMenuComponentConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Writes the lines that exclude {@link targets}, and applies them.
   */
  public async exclude(targets: readonly ExcludeMenuTarget[]): Promise<void> {
    await this.writeLines({
      lines: targets.map((target) => createExcludeLine(target)),
      shouldTargetsBeIgnored: true,
      targets
    });
  }

  /**
   * Writes the lines that exclude everything in the folder of {@link targets} except them, and applies them. Does
   * nothing when the targets are not all in one folder.
   */
  public async excludeEverythingElse(targets: readonly ExcludeMenuTarget[]): Promise<void> {
    const lines = createExcludeEverythingElseLines(targets);
    if (lines === null) {
      return;
    }
    await this.writeLines({
      lines,
      shouldTargetsBeIgnored: false,
      targets
    });
  }

  public override onload(): void {
    super.onload();
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      this.addMenuItems(menu, [file]);
    }));
    this.registerEvent(this.app.workspace.on('files-menu', (menu, files) => {
      this.addMenuItems(menu, files);
    }));
  }

  private addMenuItems(menu: Menu, files: readonly TAbstractFile[]): void {
    // The vault root has no path to write, and nothing outside it to keep it apart from.
    const targets = files
      .filter((file) => file.parent !== null)
      .map((file): ExcludeMenuTarget => ({ isFolder: isFolder(file), path: file.path }));
    if (targets.length === 0 || targets.length !== files.length) {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle('Exclude')
        .setIcon('eye-off')
        .setSection('action')
        .onClick(() => {
          invokeAsyncSafely(() => this.exclude(targets));
        });
    });

    if (createExcludeEverythingElseLines(targets) === null) {
      return;
    }
    menu.addItem((item) => {
      item
        .setTitle('Exclude everything else in this folder')
        .setIcon('minus-circle')
        .setSection('action')
        .onClick(() => {
          invokeAsyncSafely(() => this.excludeEverythingElse(targets));
        });
    });
  }

  private appendLayerName(f: DocumentFragment, layer: ExcludeMenuLayer): void {
    if (layer === ExcludeMenuLayer.Local) {
      appendCodeBlock(f, OBSIDIAN_IGNORE_FILE);
      f.appendText(', on this device only');
      return;
    }
    f.appendText('the global patterns');
    const activeProfile = this.pluginSettingsComponent.effectiveSettings.activeProfile;
    if (!activeProfile) {
      return;
    }

    f.appendText(' of the base settings, which the active profile ');
    appendCodeBlock(f, activeProfile.name);
    f.appendText(' builds on');
  }

  private showResult(params: ExcludeMenuComponentShowResultParams): void {
    const { addedLines, layer, shouldTargetsBeIgnored, targets } = params;
    const mismatchedTargets = targets.filter((target) => this.ignorePatternsComponent.isIgnored({ isFolder: target.isFolder, normalizedPath: target.path }) !== shouldTargetsBeIgnored);

    this.pluginNoticeComponent.showNotice(createFragment((f) => {
      if (addedLines.length === 0) {
        f.appendText('Nothing to add: the lines are already in ');
      } else {
        f.appendText('Added ');
        appendCodeList(f, addedLines);
        f.appendText(' to ');
      }
      this.appendLayerName(f, layer);
      f.appendText('.');

      if (mismatchedTargets.length === 0) {
        return;
      }
      f.createEl('br');
      f.appendText(shouldTargetsBeIgnored ? 'Still shown: ' : 'Still excluded: ');
      appendCodeList(f, mismatchedTargets.map((target) => target.path));
      f.appendText('. Another line, or the active profile, overrides these lines; see the plugin settings.');
    }));
  }

  private async writeLines(params: ExcludeMenuComponentWriteLinesParams): Promise<void> {
    const layer = this.pluginSettingsComponent.settings.excludeMenuLayer;
    const isLocal = layer === ExcludeMenuLayer.Local;
    const currentText = isLocal ? this.ignorePatternsComponent.getLocalPatternsText() : this.pluginSettingsComponent.settings.ignorePatterns;
    const { addedLines, text } = appendPatternLines(currentText, params.lines);
    if (addedLines.length > 0) {
      if (isLocal) {
        await this.ignorePatternsComponent.saveLocalPatterns(text);
      } else {
        // A save applies the change as an edit made outside the settings tab is applied: at once, in every mode.
        await this.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = text;
        });
      }
    }
    this.showResult({ ...params, addedLines, layer });
  }
}

function appendCodeList(f: DocumentFragment, items: readonly string[]): void {
  for (const [index, item] of items.entries()) {
    if (index > 0) {
      f.appendText(', ');
    }
    appendCodeBlock(f, item);
  }
}
