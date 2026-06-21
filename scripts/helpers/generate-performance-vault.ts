import type { PopulateFilesParams } from 'obsidian-integration-testing';

/**
 * The single ignored folder the performance vault hangs everything under. The
 * `vault-real-scale.desktop-performance.integration.test.ts` test ignores this
 * folder, so the two must agree.
 */
export const PERFORMANCE_VAULT_FOLDER = 'big';

/**
 * A sibling note outside {@link PERFORMANCE_VAULT_FOLDER} that must stay visible.
 */
export const PERFORMANCE_VAULT_CONTROL = 'keep-real.md';

// Roughly the maintainer's real F:\Obsidian vault size; spread across folders.
// Overridable via AE_PERF_VAULT_SIZE for bounded diagnostic runs (e.g. 20000).
const DEFAULT_PERFORMANCE_VAULT_SIZE = 90_000;
const PERFORMANCE_VAULT_SIZE = Number(process.env['AE_PERF_VAULT_SIZE']) || DEFAULT_PERFORMANCE_VAULT_SIZE;
const FILES_PER_FOLDER = 30;

/**
 * Builds the file map for a large vault, written to disk by `TempVault.populate()`
 * before Obsidian opens it (so its startup scan indexes it in one pass — far
 * faster and more reliable than writing notes after open and forcing a re-scan).
 *
 * @returns A map of vault-relative note paths to (empty) content.
 */
export function generatePerformanceVault(): PopulateFilesParams {
  const files: PopulateFilesParams = { [PERFORMANCE_VAULT_CONTROL]: 'control' };
  let written = 0;
  let folderIndex = 0;
  while (written < PERFORMANCE_VAULT_SIZE) {
    for (let fileIndex = 0; fileIndex < FILES_PER_FOLDER && written < PERFORMANCE_VAULT_SIZE; fileIndex++) {
      files[`${PERFORMANCE_VAULT_FOLDER}/dir-${String(folderIndex)}/file-${String(fileIndex)}.md`] = '';
      written++;
    }
    folderIndex++;
  }
  return files;
}
