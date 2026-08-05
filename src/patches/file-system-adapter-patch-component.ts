import type { FileSystemAdapter } from 'obsidian';

import type {
  AdapterPatchBaseComponentConstructorParams,
  GenericReconcileFunction
} from './adapter-patch-base-component.ts';

import { AdapterPatchBaseComponent } from './adapter-patch-base-component.ts';

interface FileSystemAdapterPatchComponentConstructorParams extends AdapterPatchBaseComponentConstructorParams {
  readonly adapter: FileSystemAdapter;
}

export class FileSystemAdapterPatchComponent extends AdapterPatchBaseComponent {
  private readonly adapter: FileSystemAdapter;

  public constructor(params: FileSystemAdapterPatchComponentConstructorParams) {
    super(params);
    this.adapter = params.adapter;
  }

  public override onload(): void {
    this.registerMethodPatch({
      $object: this.adapter,
      methodName: 'reconcileFileCreation',
      patchHandler: ({
        originalArguments,
        originalMethod
      }) => {
        return this.generateReconcileWrapper(originalMethod as GenericReconcileFunction, false)(...originalArguments);
      }
    });

    this.registerMethodPatch({
      $object: this.adapter,
      methodName: 'reconcileFolderCreation',
      patchHandler: ({
        originalArguments,
        originalMethod
      }) => {
        return this.generateReconcileWrapper(originalMethod as GenericReconcileFunction, true)(...originalArguments);
      }
    });
  }
}
