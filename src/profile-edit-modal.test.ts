import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SettingsProfile } from './plugin-settings.ts';

import { readIfExists } from './data-adapter-safe.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';
import { ProfileEditModal } from './profile-edit-modal.ts';

vi.mock('./data-adapter-safe.ts', () => ({
  readIfExists: vi.fn()
}));

interface OpenModalResult {
  readonly modal: ProfileEditModal;
  readonly onSave: ReturnType<typeof vi.fn<(profile: SettingsProfile) => Promise<void>>>;
}

describe('ProfileEditModal', () => {
  beforeEach(() => {
    // The mock `Modal.open` schedules a `close` on a zero-delay timer; fake timers keep the modal open.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show the profile and its live expansion', () => {
    const { modal } = openModal({ id: 'work', name: 'Work', patterns: '@import Base\nwork/', shouldHideEmptyFolders: true, shouldIgnoreExcludedFiles: false });

    expect(modal.titleEl.textContent).toBe('Edit profile: Work');
    expect(getInput(modal).value).toBe('Work');
    expect(getTextArea(modal).value).toBe('@import Base\nwork/');
    expect(getSelects(modal).map((select) => select.value)).toStrictEqual(['inherit', 'inherit', 'off', 'on']);
    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('base: base/');
    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('Base: from-base/');
    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('Work: work/');
    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('hide empty folders: on');
    expect(modal.contentEl.textContent).toContain('None.');
  });

  it('should show the errors of the edited patterns as they are typed', () => {
    const { modal } = openModal({ id: 'work', name: 'Work', patterns: '' });

    typeInto(getTextArea(modal), 'a/\n@import Missing');

    expect(modal.contentEl.textContent).toContain('Work, line 2: Unknown profile `Missing`.');
  });

  it('should save the edited name, patterns and overrides', async () => {
    const { modal, onSave } = openModal({ excludeMode: ExcludeMode.Full, id: 'work', name: 'Work', patterns: 'a/' });
    const [excludeModeSelect, gitIgnoreSelect, excludedFilesSelect, emptyFoldersSelect] = getSelects(modal);

    typeInto(getInput(modal), '  Office  ');
    typeInto(getTextArea(modal), 'b/');
    choose(excludeModeSelect, 'inherit');
    choose(gitIgnoreSelect, 'on');
    choose(excludedFilesSelect, 'off');
    choose(emptyFoldersSelect, 'inherit');
    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('.gitignore patterns: on');
    clickButton(modal, 'Save');
    await waitForAllAsyncOperations();

    expect(onSave).toHaveBeenCalledWith({
      excludeMode: undefined,
      id: 'work',
      name: 'Office',
      patterns: 'b/',
      shouldHideEmptyFolders: undefined,
      shouldIgnoreExcludedFiles: false,
      shouldIncludeGitIgnorePatterns: true
    });
  });

  it('should set an explicit exclude mode', async () => {
    const { modal, onSave } = openModal({ id: 'work', name: 'Work', patterns: '' });

    choose(getSelects(modal)[0], ExcludeMode.FilesPane);
    clickButton(modal, 'Save');
    await waitForAllAsyncOperations();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ excludeMode: ExcludeMode.FilesPane }));
  });

  it('should refuse to save an empty or duplicate name', async () => {
    const { modal, onSave } = openModal({ id: 'work', name: 'Work', patterns: '' });

    typeInto(getInput(modal), ' '.repeat(3));
    expect(getText(modal, '.advanced-exclude-profile-error')).toBe('A profile needs a name.');
    clickButton(modal, 'Save');

    typeInto(getInput(modal), 'base');
    expect(getText(modal, '.advanced-exclude-profile-error')).toBe('Another profile is already named "base".');
    clickButton(modal, 'Save');
    await waitForAllAsyncOperations();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('should show an imported file the plugin already read, labelled with its path', () => {
    const { modal } = openModal({ id: 'work', name: 'Work', patterns: '@import file:.gitignore' }, new Map([['.gitignore', 'node_modules/']]));

    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('Work (.gitignore): node_modules/');
    expect(readIfExists).not.toHaveBeenCalled();
  });

  it('should read a file the draft newly imports and show it, or report it missing', async () => {
    vi.mocked(readIfExists).mockImplementation((_app, path) => Promise.resolve(path === 'work.txt' ? 'from-file/' : null));
    const { modal } = openModal({ id: 'work', name: 'Work', patterns: '' });

    typeInto(getTextArea(modal), '@import file:work.txt\n@import file:gone.txt');
    await waitForAllAsyncOperations();

    expect(getText(modal, '.advanced-exclude-profile-expansion')).toContain('Work (work.txt): from-file/');
    expect(modal.contentEl.textContent).toContain('Work, line 2: File `gone.txt` does not exist.');
  });

  it('should refuse a name that would read as a file import', () => {
    const { modal } = openModal({ id: 'work', name: 'Work', patterns: '' });

    typeInto(getInput(modal), 'file:x');

    expect(getText(modal, '.advanced-exclude-profile-error')).toBe('A profile name cannot start with "file:": that imports a file.');
  });

  it('should close without saving on Cancel', () => {
    const { modal, onSave } = openModal({ id: 'work', name: 'Work', patterns: '' });

    clickButton(modal, 'Cancel');

    expect(onSave).not.toHaveBeenCalled();
    expect(modal.contentEl.childElementCount).toBe(0);
  });
});

function choose(select: HTMLSelectElement | undefined, value: string): void {
  if (!select) {
    throw new Error('No such select');
  }
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function clickButton(modal: ProfileEditModal, text: string): void {
  const button = [...modal.contentEl.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
  if (!button) {
    throw new Error(`No button ${text}`);
  }
  button.click();
}

function getInput(modal: ProfileEditModal): HTMLInputElement {
  const input = modal.contentEl.querySelector('input');
  if (!input) {
    throw new Error('No input');
  }
  return input;
}

function getSelects(modal: ProfileEditModal): HTMLSelectElement[] {
  return [...modal.contentEl.querySelectorAll('select')];
}

function getText(modal: ProfileEditModal, selector: string): string {
  return modal.contentEl.querySelector(selector)?.textContent ?? '';
}

function getTextArea(modal: ProfileEditModal): HTMLTextAreaElement {
  const textArea = modal.contentEl.querySelector('textarea');
  if (!textArea) {
    throw new Error('No textarea');
  }
  return textArea;
}

function openModal(profile: SettingsProfile, importedFileContents: ReadonlyMap<string, null | string> = new Map()): OpenModalResult {
  const settings = Object.assign(new PluginSettings(), {
    obsidianIgnoreContent: 'base/',
    profiles: [{ id: 'base', name: 'Base', patterns: 'from-base/' }, profile]
  });
  const onSave = vi.fn<(editedProfile: SettingsProfile) => Promise<void>>().mockResolvedValue(undefined);
  const modal = new ProfileEditModal({
    app: App.createConfigured__().asOriginalType__(),
    importedFileContents,
    onSave,
    profile,
    settings
  });
  modal.open();
  return { modal, onSave };
}

function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('input'));
}
