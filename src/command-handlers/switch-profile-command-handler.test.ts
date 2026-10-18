import { noop } from '@mnaoumov/typescript-lib/function';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { ProfileSuggestModal } from '../profile-suggest-modal.ts';
import { createFakeSettings } from '../test-helpers/fake-plugin-settings-component.ts';
import { SwitchProfileCommandHandler } from './switch-profile-command-handler.ts';

describe('SwitchProfileCommandHandler', () => {
  it('should be available once a profile exists, and open the picker', () => {
    const fake = createFakeSettings();
    const openSpy = vi.spyOn(ProfileSuggestModal.prototype, 'open').mockImplementation(noop);
    const command = new SwitchProfileCommandHandler({ app: App.createConfigured__().asOriginalType__(), pluginSettingsComponent: fake.pluginSettingsComponent })
      .buildCommand();

    expect(command.checkCallback?.(true)).toBe(false);

    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);
    expect(openSpy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
