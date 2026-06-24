import type { FileSystemAdapter } from 'obsidian';

import type {
  AdapterPatchBaseComponentConstructorParams,
  GenericReconcileFn
} from './adapter-patch-base-component.ts';

import { AdapterPatchBaseComponent } from './adapter-patch-base-component.ts';

type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];

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
      methodName: 'reconcileFileCreation',
      obj: this.adapter,
      patchHandler: ({
        originalArgs,
        originalMethod
      }) => {
        return this.generateReconcileWrapper(originalMethod as GenericReconcileFn, false)(...originalArgs);
      }
    });

    this.registerMethodPatch({
      methodName: 'reconcileFolderCreation',
      obj: this.adapter,
      patchHandler: ({
        originalArgs,
        originalMethod
      }) => {
        return this.generateReconcileWrapper(originalMethod as GenericReconcileFn, true)(...originalArgs);
      }
    });
  }
}
