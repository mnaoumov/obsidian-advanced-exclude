import {
  App,
  Component,
  Vault
} from 'obsidian';
import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';

type VaultLoadFn = Vault['load'];

export class VaultLoadPatch extends Component {
  public get vaultLoadCalled(): boolean {
    return this._vaultLoadCalled;
  }

  private _vaultLoadCalled = false;

  public constructor(private readonly app: App) {
    super();
  }

  public override onload(): void {
    super.onload();

    registerPatch(this, this.app.vault, {
      load: (next: VaultLoadFn): VaultLoadFn => {
        return () => this.vaultLoad(next);
      }
    });
  }

  private async vaultLoad(next: VaultLoadFn): Promise<void> {
    this._vaultLoadCalled = true;
    await next.call(this.app.vault);
  }
}
