import type { AsyncEventRef } from '@mnaoumov/typescript-lib/async-events';
import type { Promisable } from 'type-fest';

import {
  noop,
  noopAsync
} from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { vi } from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { EffectiveSettings } from '../profiles.ts';

import { PluginSettings } from '../plugin-settings.ts';
import { resolveProfile } from '../profiles.ts';

interface FakeSettings {
  readonly fireActiveProfileChange: () => Promise<void>;
  readonly fireSettingsEvent: (name: string) => void;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly setActiveProfileId: ReturnType<typeof vi.fn<(profileId: null | string) => Promise<void>>>;
  readonly settings: PluginSettings;
}

/**
 * A `PluginSettingsComponent` double whose effective settings resolve live from {@link FakeSettings.settings} and
 * the active profile id that `setActiveProfileId` records.
 */
export function createFakeSettings(): FakeSettings {
  const settings = new PluginSettings();
  let activeProfileId: null | string = null;
  const settingsListeners = new Map<string, () => void>();
  let activeProfileChangeListener: (() => Promisable<void>) | undefined;
  const setActiveProfileId = vi.fn((profileId: null | string) => {
    activeProfileId = profileId;
    return noopAsync();
  });
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    get effectiveSettings(): EffectiveSettings {
      // Not a plain object: strictProxy caches a plain object a getter returns, which would freeze the first answer.
      return Object.assign(Object.create(null) as EffectiveSettings, resolveProfile({ activeProfileId, settings }));
    },
    on: vi.fn((name: string, callback: () => void) => {
      settingsListeners.set(name, callback);
      return strictProxy<AsyncEventRef>({ asyncEventSource: { offref: vi.fn() } });
    }),
    onActiveProfileChange: vi.fn((listener: () => Promisable<void>) => {
      activeProfileChangeListener = listener;
      return noop;
    }),
    setActiveProfileId,
    settings
  });
  return {
    fireActiveProfileChange: async (): Promise<void> => {
      await activeProfileChangeListener?.();
    },
    fireSettingsEvent: (name: string): void => {
      settingsListeners.get(name)?.();
    },
    pluginSettingsComponent,
    setActiveProfileId,
    settings
  };
}
