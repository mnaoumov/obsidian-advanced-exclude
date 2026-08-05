import { App } from 'obsidian';
import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';

export class VaultLoadPatchComponent extends MonkeyAroundComponent {
  public get wasVaultLoadCalled(): boolean {
    return this._vaultLoadCalled;
  }

  private _vaultLoadCalled = false;

  public constructor(private readonly app: App) {
    super();
  }

  public override onload(): void {
    super.onload();
    this.registerMethodPatch({
      $object: this.app.vault,
      methodName: 'load',
      patchHandler: async ({
        fallback
      }) => {
        this._vaultLoadCalled = true;
        await fallback();
      }
    });
  }
}
