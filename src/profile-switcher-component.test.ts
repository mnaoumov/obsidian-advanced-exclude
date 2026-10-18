import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { Menu } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { ProfileSwitcherComponent } from './profile-switcher-component.ts';
import { createFakeSettings } from './test-helpers/fake-plugin-settings-component.ts';

const BASE_SETTINGS_LABEL = 'Base settings';

describe('ProfileSwitcherComponent', () => {
  it('should stay hidden until a profile exists, and show the active one', async () => {
    const fake = createFakeSettings();
    const statusBarItemEl = createDiv();
    const component = new ProfileSwitcherComponent({ addStatusBarItem: (): HTMLElement => statusBarItemEl, pluginSettingsComponent: fake.pluginSettingsComponent });
    component.load();

    expect(statusBarItemEl.style.display).toBe('none');
    expect(statusBarItemEl.textContent).toBe(`Exclude: ${BASE_SETTINGS_LABEL}`);

    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    fake.fireSettingsEvent('saveSettings');
    expect(statusBarItemEl.style.display).not.toBe('none');

    await fake.setActiveProfileId('work');
    await fake.fireActiveProfileChange();
    expect(statusBarItemEl.textContent).toBe('Exclude: Work');

    fake.settings.profiles = [];
    fake.fireSettingsEvent('loadSettings');
    expect(statusBarItemEl.style.display).toBe('none');
  });

  it('should switch the profile from the status-bar menu', async () => {
    const fake = createFakeSettings();
    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    await fake.setActiveProfileId('work');
    fake.setActiveProfileId.mockClear();
    const statusBarItemEl = createDiv();
    const component = new ProfileSwitcherComponent({ addStatusBarItem: (): HTMLElement => statusBarItemEl, pluginSettingsComponent: fake.pluginSettingsComponent });
    component.load();
    const showAtMouseEventSpy = vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockReturnThis();

    statusBarItemEl.click();
    const shownMenu = showAtMouseEventSpy.mock.contexts[0] as Menu | undefined;

    const items = shownMenu?.menuItems__ ?? [];
    expect(items.map((item) => [item.title__, item.checked])).toStrictEqual([[BASE_SETTINGS_LABEL, false], ['Work', true]]);
    items[0]?.onClick__?.(new MouseEvent('click'));
    await waitForAllAsyncOperations();
    expect(fake.setActiveProfileId).toHaveBeenCalledWith(null);
    vi.restoreAllMocks();
  });

  it('should check the base settings in the menu when no profile is active', () => {
    const fake = createFakeSettings();
    const statusBarItemEl = createDiv();
    const component = new ProfileSwitcherComponent({ addStatusBarItem: (): HTMLElement => statusBarItemEl, pluginSettingsComponent: fake.pluginSettingsComponent });
    component.load();
    const showAtMouseEventSpy = vi.spyOn(Menu.prototype, 'showAtMouseEvent').mockReturnThis();

    statusBarItemEl.click();
    const shownMenu = showAtMouseEventSpy.mock.contexts[0] as Menu | undefined;

    expect(shownMenu?.menuItems__.map((item) => item.checked)).toStrictEqual([true]);
    vi.restoreAllMocks();
  });

  it('should remove its status-bar item on unload, and tolerate a refresh afterwards', () => {
    const fake = createFakeSettings();
    const statusBarItemEl = createDiv();
    const parentEl = createDiv();
    parentEl.append(statusBarItemEl);
    const component = new ProfileSwitcherComponent({ addStatusBarItem: (): HTMLElement => statusBarItemEl, pluginSettingsComponent: fake.pluginSettingsComponent });
    component.load();

    component.unload();

    expect(parentEl.childElementCount).toBe(0);
    expect(() => {
      component.refresh();
    }).not.toThrow();
  });
});
