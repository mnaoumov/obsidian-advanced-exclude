import type { PopulateFilesParams } from 'obsidian-integration-testing';

import { readDemoVaultTree } from 'obsidian-integration-testing';
import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import { generatePerformanceVault } from './helpers/generate-performance-vault.ts';

/*
 * `AE_PERF_VAULT_SOURCE` points the run at a directory copy of a real vault instead of the
 * synthetic tree, for diagnostic runs at a real vault's shape. Only the
 * `lifecycle-scale` suite asserts nothing about the vault's content, so run it alone then.
 */
const vaultSourcePath = process.env['AE_PERF_VAULT_SOURCE'];

/**
 * Vitest global setup for the `integration-tests:desktop-performance` project: it
 * pre-populates the vault with a large note tree via `TemporaryVault.populate()` before
 * Obsidian opens it, so the startup scan indexes everything in one pass.
 */
export const { setup, teardown } = createSetup({
  populate: vaultSourcePath ? (): PopulateFilesParams => readDemoVaultTree({ demoVaultPath: vaultSourcePath }) : generatePerformanceVault
});
