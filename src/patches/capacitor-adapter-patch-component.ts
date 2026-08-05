import type { CapacitorAdapter } from 'obsidian';

import type {
  AdapterPatchBaseComponentConstructorParams,
  GenericReconcileFunction
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
      $object: this.adapter,
      methodName: 'reconcileFileCreation',
      patchHandler: async ({
        originalArguments,
        originalMethod
      }) => {
        await this.generateReconcileWrapper(originalMethod as GenericReconcileFunction, false)(...originalArguments);
      }
    });

    this.registerMethodPatch({
      $object: this.adapter,
      methodName: 'reconcileFolderCreation',
      patchHandler: async ({
        originalArguments,
        originalMethod
      }) => {
        await this.generateReconcileWrapper(originalMethod as GenericReconcileFunction, true)(...originalArguments);
      }
    });
  }
}
