import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  BASE_SETTINGS_LABEL,
  ProfileSuggestModal
} from './profile-suggest-modal.ts';
import { createFakeSettings } from './test-helpers/fake-plugin-settings-component.ts';

describe('ProfileSuggestModal', () => {
  it('should list the base settings first and switch to the chosen entry', async () => {
    const fake = createFakeSettings();
    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    const modal = new ProfileSuggestModal(App.createConfigured__().asOriginalType__(), fake.pluginSettingsComponent);

    const items = modal.getItems();
    expect(items).toStrictEqual([{ id: null, name: BASE_SETTINGS_LABEL }, { id: 'work', name: 'Work' }]);
    expect(modal.getItemText({ id: 'work', name: 'Work' })).toBe('Work');

    modal.onChooseItem({ id: 'work', name: 'Work' });
    await waitForAllAsyncOperations();
    expect(fake.setActiveProfileId).toHaveBeenCalledWith('work');
  });
});
