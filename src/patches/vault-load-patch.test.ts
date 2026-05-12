import type { Vault } from 'obsidian';

import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { VaultLoadPatch } from './vault-load-patch.ts';

vi.mock('obsidian-dev-utils/obsidian/monkey-around', () => ({
  registerPatch: vi.fn()
}));

const mockRegisterPatch = vi.mocked(registerPatch);

describe('VaultLoadPatch', () => {
  let app: App;
  let patch: VaultLoadPatch;

  beforeEach(() => {
    mockRegisterPatch.mockClear();
    app = App.createConfigured__();
    patch = new VaultLoadPatch(app.asOriginalType__());
  });

  it('should initially have vaultLoadCalled as false', () => {
    expect(patch.vaultLoadCalled).toBe(false);
  });

  describe('onload', () => {
    it('should register a patch on vault.load', () => {
      patch.onload();
      expect(mockRegisterPatch).toHaveBeenCalledWith(
        patch,
        app.vault,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
        expect.objectContaining({ load: expect.any(Function) })
      );
    });
  });

  describe('patched vault.load', () => {
    it('should set vaultLoadCalled to true and call next', async () => {
      patch.onload();
      const patchDefs = mockRegisterPatch.mock.calls[0]?.[2] as Record<string, (next: Vault['load']) => Vault['load']>;
      const loadPatchFactory = patchDefs['load'];
      if (!loadPatchFactory) {
        throw new Error('load patch factory not found');
      }
      const mockNext = vi.fn<Vault['load']>().mockResolvedValue(undefined);
      const patchedLoad = loadPatchFactory(mockNext);

      // The patched load ignores `this` context - it captures the VaultLoadPatch instance via closure
      await patchedLoad();

      expect(patch.vaultLoadCalled).toBe(true);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
