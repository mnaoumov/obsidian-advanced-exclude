import type { CapacitorAdapter } from 'obsidian';

import type {
  AdapterPatchBaseComponentConstructorParams,
  GenericReconcileFn
} from './adapter-patch-base-component.ts';

import { AdapterPatchBaseComponent } from './adapter-patch-base-component.ts';

interface CapacitorAdapterPatchComponentConstructorParams extends AdapterPatchBaseComponentConstructorParams {
  readonly adapter: CapacitorAdapter;
}

export class CapacitorAdapterPatchComponent extends AdapterPatchBaseComponent {
  private readonly adapter: CapacitorAdapter;

  public constructor(params: CapacitorAdapterPatchComponentConstructorParams) {
    super(params);
    this.adapter = params.adapter;
  }

  public override onload(): void {
    super.onload();

    this.registerMethodPatch({
      methodName: 'reconcileFileCreation',
      obj: this.adapter,
      patchHandler: async ({
        originalArgs,
        originalMethod
      }) => {
        await this.generateReconcileWrapper(originalMethod as GenericReconcileFn, false)(...originalArgs);
      }
    });

    this.registerMethodPatch({
      methodName: 'reconcileFolderCreation',
      obj: this.adapter,
      patchHandler: async ({
        originalArgs,
        originalMethod
      }) => {
        await this.generateReconcileWrapper(originalMethod as GenericReconcileFn, true)(...originalArgs);
      }
    });
  }
}
