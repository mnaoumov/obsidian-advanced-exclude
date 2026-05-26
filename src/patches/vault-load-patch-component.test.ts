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
  it('should have vaultLoadCalled initially false', () => {
    const app = App.createConfigured__();
    const component = new VaultLoadPatchComponent(app.asOriginalType__());

    expect(component.vaultLoadCalled).toBe(false);
  });

  it('should set vaultLoadCalled to true when vault.load is called', async () => {
    const app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.vault.load = vi.fn().mockResolvedValue(undefined);
    const component = new VaultLoadPatchComponent(appOriginal);

    component.load();

    // Call the patched vault.load
    await appOriginal.vault.load();

    expect(component.vaultLoadCalled).toBe(true);
  });

  it('should call super.onload', () => {
    const app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.vault.load = vi.fn().mockResolvedValue(undefined);
    const component = new VaultLoadPatchComponent(appOriginal);

    const grandParentProto = Object.getPrototypeOf(Object.getPrototypeOf(component) as object) as OnloadAccessor;
    const superOnloadSpy = vi.spyOn(grandParentProto, 'onload');
    component.load();

    expect(superOnloadSpy).toHaveBeenCalled();
    superOnloadSpy.mockRestore();
  });
});
