import type { FileSystemAdapter } from 'obsidian';

import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';

import type {
  AdapterPatchBaseConstructorParams,
  DataAdapterReconcileDeletionFn,
  DataAdapterReconcileFolderCreationFn,
  GenericReconcileFn
} from './adapter-patch-base.ts';

import { AdapterPatchBase } from './adapter-patch-base.ts';

export type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];

interface FileSystemAdapterPatchConstructorParams extends AdapterPatchBaseConstructorParams {
  readonly adapter: FileSystemAdapter;
}

export class FileSystemAdapterPatch extends AdapterPatchBase {
  private readonly adapter: FileSystemAdapter;

  public constructor(params: FileSystemAdapterPatchConstructorParams) {
    super(params);
    this.adapter = params.adapter;
  }

  public override onload(): void {
    super.onload();
    registerPatch(this, this.adapter, {
      reconcileDeletion: (next: DataAdapterReconcileDeletionFn): DataAdapterReconcileDeletionFn => {
        return async (normalizedPath: string, normalizedNewPath: string, shouldSkipDeletionTimeout?: boolean): Promise<void> => {
          return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
        };
      },
      reconcileFileCreation: (next: FileSystemAdapterReconcileFileCreationFn): FileSystemAdapterReconcileFileCreationFn =>
        this.generateReconcileWrapper(next as GenericReconcileFn, false),
      reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
        this.generateReconcileWrapper(next as GenericReconcileFn, true)
    });
  }
}
