import type { CapacitorAdapter } from 'obsidian';

import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';

import type {
  AdapterPatchBaseConstructorParams,
  DataAdapterReconcileDeletionFn,
  DataAdapterReconcileFolderCreationFn,
  GenericReconcileFn
} from './adapter-patch-base.ts';

import { AdapterPatchBase } from './adapter-patch-base.ts';

export type CapacitorAdapterReconcileFileCreationFn = CapacitorAdapter['reconcileFileCreation'];

interface CapacitorAdapterPatchConstructorParams extends AdapterPatchBaseConstructorParams {
  readonly adapter: CapacitorAdapter;
}

export class CapacitorAdapterPatch extends AdapterPatchBase {
  private readonly adapter: CapacitorAdapter;

  public constructor(params: CapacitorAdapterPatchConstructorParams) {
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
      reconcileFileCreation: (next: CapacitorAdapterReconcileFileCreationFn): CapacitorAdapterReconcileFileCreationFn =>
        this.generateReconcileWrapper(next as GenericReconcileFn, false),
      reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
        this.generateReconcileWrapper(next as GenericReconcileFn, true)
    });
  }
}
