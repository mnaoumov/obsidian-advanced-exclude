import type { PopulateFilesParams } from 'obsidian-integration-testing';
import type { VitestGlobalSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import { readDemoVaultTree } from 'obsidian-integration-testing';
import { createSetup } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import { generatePerformanceVault } from './generate-performance-vault.ts';

/*
 * `AE_PERF_VAULT_SOURCE` points the run at a directory copy of a real vault instead of the
 * synthetic tree, for diagnostic runs at a real vault's shape. Only the
 * `lifecycle-scale` suite asserts nothing about the vault's content, so run it alone then.
 */
const vaultSourcePath = process.env['AE_PERF_VAULT_SOURCE'];

/**
 * Creates a separate owned performance fixture for each project, populated before Obsidian opens.
 *
 * @returns The project's own global setup and teardown pair.
 */
export function createPerformanceSetup(): VitestGlobalSetup {
  return createSetup({
    populate: vaultSourcePath ? (): PopulateFilesParams => readDemoVaultTree({ demoVaultPath: vaultSourcePath }) : generatePerformanceVault
  });
}
