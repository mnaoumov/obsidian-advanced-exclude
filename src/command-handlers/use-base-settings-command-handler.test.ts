import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import {
  describe,
  expect,
  it
} from 'vitest';

import { createFakeSettings } from '../test-helpers/fake-plugin-settings-component.ts';
import { UseBaseSettingsCommandHandler } from './use-base-settings-command-handler.ts';

describe('UseBaseSettingsCommandHandler', () => {
  it('should be available while a profile is active, and deactivate it', async () => {
    const fake = createFakeSettings();
    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    const command = new UseBaseSettingsCommandHandler({ pluginSettingsComponent: fake.pluginSettingsComponent }).buildCommand();

    expect(command.checkCallback?.(true)).toBe(false);

    await fake.setActiveProfileId('work');
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);
    await waitForAllAsyncOperations();
    expect(fake.setActiveProfileId).toHaveBeenLastCalledWith(null);
  });
});
