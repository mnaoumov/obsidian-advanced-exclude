import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { VaultLoadPatchComponent } from './vault-load-patch-component.ts';

interface OnloadAccessor {
  onload(): void;
}

describe('VaultLoadPatchComponent', () => {
  it('should have wasVaultLoadCalled initially false', () => {
    const app = App.createConfigured__();
    const component = new VaultLoadPatchComponent(app.asOriginalType__());

    expect(component.wasVaultLoadCalled).toBe(false);
  });

  it('should set wasVaultLoadCalled to true when vault.load is called', async () => {
    const app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.vault.load = vi.fn().mockResolvedValue(undefined);
    const component = new VaultLoadPatchComponent(appOriginal);

    component.load();

    // Call the patched vault.load
    await appOriginal.vault.load();

    expect(component.wasVaultLoadCalled).toBe(true);
  });

  it('should call super.onload', () => {
    const app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.vault.load = vi.fn().mockResolvedValue(undefined);
    const component = new VaultLoadPatchComponent(appOriginal);

    const grandParentPrototype = Object.getPrototypeOf(Object.getPrototypeOf(component) as object) as OnloadAccessor;
    const superOnloadSpy = vi.spyOn(grandParentPrototype, 'onload');
    component.load();

    expect(superOnloadSpy).toHaveBeenCalled();
    superOnloadSpy.mockRestore();
  });
});
